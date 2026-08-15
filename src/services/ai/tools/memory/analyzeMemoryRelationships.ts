import { z } from "zod";

import { getAsyncLLM } from "../../llm";
import { MEMORY_RELATIONSHIP_ANALYSIS_PROMPT } from "./prompts";

import type { MemoryNode } from "./enrichMemory";
import type { SimilarMemoryResult } from "./findSimilarMemories";

const MEMORY_RELATIONSHIPS = [
  "COMPLEMENTS",
  "CONTRADICTS",
  "RELATED",
  "DUPLICATE",
  "UNRELATED",
] as const;

export type MemoryRelationshipType =
  (typeof MEMORY_RELATIONSHIPS)[number];

/**
 * The model only classifies the factual relationship.
 *
 * Confidence and target metadata are generated locally.
 */
const relationshipDecisionSchema = z
  .object({
    relationship: z.enum(MEMORY_RELATIONSHIPS),
  })
  .strict();

type MemoryRelationshipDecision = z.infer<
  typeof relationshipDecisionSchema
>;

export type MemoryRelationship = {
  relationship: MemoryRelationshipType;
  confidence: number;
};

export type MemoryRelationshipAnalysis = {
  targetFileName: string;
  targetMemoryId: string;
  similarity: number;
  analysis: MemoryRelationship;
};

type ComparableMemory = {
  content: string;
  context?: string;
  key?: string | string[];
  tags?: string[];
  time?: MemoryNode["time"];
};

/**
 * Reuses the same cheap LLM wrapper for all relationship analyses.
 *
 * If initialization fails, the rejected promise is cleared so a later
 * operation can retry.
 */
let cheapRelationshipLlmPromise:
  | ReturnType<typeof getAsyncLLM>
  | undefined;

function getCheapRelationshipLlm(): ReturnType<
  typeof getAsyncLLM
> {
  if (!cheapRelationshipLlmPromise) {
    cheapRelationshipLlmPromise = getAsyncLLM(
      "cheap",
    ).catch((error: unknown) => {
      cheapRelationshipLlmPromise = undefined;
      throw error;
    });
  }

  return cheapRelationshipLlmPromise;
}

function createAbortError(): DOMException {
  return new DOMException(
    "The operation was cancelled.",
    "AbortError",
  );
}

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/**
 * Analyzes the relationship between a new memory and every candidate.
 *
 * Important:
 * - Embedding similarity is only used for candidate retrieval and scoring.
 * - Every relationship, including DUPLICATE, is classified by the LLM.
 * - No semantic duplicate is inferred from embedding similarity alone.
 * - AbortError is allowed to propagate to the caller.
 */
export async function analyzeMemoryRelationships(
  newMemory: MemoryNode,
  similarMemories: SimilarMemoryResult[],
  signal?: AbortSignal,
): Promise<MemoryRelationshipAnalysis[]> {
  throwIfAborted(signal);

  if (similarMemories.length === 0) {
    return [];
  }

  /*
   * Initialize the wrapper once before starting the analyses. This avoids
   * repeatedly checking initialization while preserving parallel requests.
   */
  const llm = await getCheapRelationshipLlm();

  throwIfAborted(signal);

  const structuredLlm = llm.withStructuredOutput(
    relationshipDecisionSchema,
  );

  const newComparableMemory =
    toComparableMemory(newMemory);

  const analyses = await Promise.all(
    similarMemories.map((similarMemory) =>
      analyzeSingleMemoryRelationship(
        newComparableMemory,
        similarMemory,
        structuredLlm,
        signal,
      ),
    ),
  );

  throwIfAborted(signal);

  return analyses;
}

/**
 * The minimum interface required from the structured LLM.
 *
 * Defining this locally avoids coupling this module to a concrete provider or
 * LangChain model class.
 */
type StructuredRelationshipLlm = {
  invoke(
    input: string,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<MemoryRelationshipDecision>;
};

/**
 * Analyzes one candidate memory.
 *
 * The LLM is responsible for selecting the relationship, including
 * DUPLICATE. Similarity does not select or override the relationship.
 */
async function analyzeSingleMemoryRelationship(
  newMemory: ComparableMemory,
  similarMemory: SimilarMemoryResult,
  structuredLlm: StructuredRelationshipLlm,
  signal?: AbortSignal,
): Promise<MemoryRelationshipAnalysis> {
  throwIfAborted(signal);

  const similarity = normalizeSimilarity(
    similarMemory.similarity,
  );

  const targetMemory = toComparableMemory(
    similarMemory.memory,
  );

  const prompt = buildRelationshipPrompt(
    newMemory,
    targetMemory,
  );

  throwIfAborted(signal);

  const decision = await structuredLlm.invoke(
    prompt,
    {
      signal,
    },
  );

  throwIfAborted(signal);

  return {
    targetFileName: similarMemory.fileName,
    targetMemoryId: similarMemory.memory.id,
    similarity,
    analysis: {
      relationship: decision.relationship,
      confidence: calculateConfidence(
        decision.relationship,
        similarity,
      ),
    },
  };
}

function buildRelationshipPrompt(
  newMemory: ComparableMemory,
  targetMemory: ComparableMemory,
): string {
  return MEMORY_RELATIONSHIP_ANALYSIS_PROMPT
    .replace(
      "{newMemory}",
      JSON.stringify(newMemory),
    )
    .replace(
      "{targetMemory}",
      JSON.stringify(targetMemory),
    );
}

/**
 * Produces a local relationship score.
 *
 * This is not a probability reported by the model. Embedding similarity only
 * adjusts the score after the LLM has selected the relationship.
 *
 * DUPLICATE is scored conservatively because a false duplicate can cause an
 * important memory to be merged, replaced, or ignored.
 */
function calculateConfidence(
  relationship: MemoryRelationshipType,
  similarity: number,
): number {
  let confidence: number;

  switch (relationship) {
    case "DUPLICATE":
      /*
       * The LLM must first classify the pair as DUPLICATE.
       *
       * Similarity cannot independently create a duplicate result. It only
       * affects whether the model's duplicate decision is strong enough for
       * subsequent processing.
       */
      confidence = 0.25 + similarity * 0.75;
      break;

    case "COMPLEMENTS":
      confidence = 0.45 + similarity * 0.45;
      break;

    case "CONTRADICTS":
      /*
       * Contradictory statements can have high embedding similarity because
       * they often discuss the same entity and differ in one factual value.
       */
      confidence = 0.5 + similarity * 0.4;
      break;

    case "RELATED":
      confidence = 0.4 + similarity * 0.45;
      break;

    case "UNRELATED":
      /*
       * UNRELATED must never become a stored relationship link.
       */
      confidence = 0;
      break;

    default: {
      const exhaustiveCheck: never =
        relationship;

      return exhaustiveCheck;
    }
  }

  return roundConfidence(
    clamp(confidence, 0, 1),
  );
}

/**
 * Creates a compact factual representation for the LLM.
 *
 * Excluded fields:
 * - id: target metadata is already handled locally;
 * - links: graph state does not define the direct factual relationship;
 * - embedding: vectors are not useful as prompt text;
 * - createdAt: storage time does not necessarily represent factual time.
 */
function toComparableMemory(
  memory: MemoryNode,
): ComparableMemory {
  const comparableMemory: ComparableMemory = {
    content: normalizeInputText(memory.content),
  };

  const context = normalizeOptionalInputText(
    memory.context,
  );

  if (context !== undefined) {
    comparableMemory.context = context;
  }

  const key = normalizeKey(memory.key);

  if (key !== undefined) {
    comparableMemory.key = key;
  }

  const tags = normalizeStringArray(
    memory.tags,
  );

  if (tags.length > 0) {
    comparableMemory.tags = tags;
  }

  if (hasMeaningfulValue(memory.time)) {
    comparableMemory.time = memory.time;
  }

  return comparableMemory;
}

function normalizeInputText(
  value: unknown,
): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeOptionalInputText(
  value: unknown,
): string | undefined {
  const normalized = normalizeInputText(value);

  return normalized.length > 0
    ? normalized
    : undefined;
}

/**
 * Supports both the old string key format and the newer string-array format.
 */
function normalizeKey(
  value: unknown,
): string | string[] | undefined {
  if (typeof value === "string") {
    return normalizeOptionalInputText(value);
  }

  if (Array.isArray(value)) {
    const normalized = normalizeStringArray(
      value,
    );

    return normalized.length > 0
      ? normalized
      : undefined;
  }

  return undefined;
}

function normalizeStringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedValues = value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => normalizeInputText(item))
    .filter(
      (item): item is string =>
        item.length > 0,
    );

  return Array.from(
    new Set(normalizedValues),
  );
}

function normalizeSimilarity(
  similarity: number,
): number {
  if (!Number.isFinite(similarity)) {
    return 0;
  }

  return clamp(similarity, 0, 1);
}

function hasMeaningfulValue(
  value: unknown,
): boolean {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function roundConfidence(
  confidence: number,
): number {
  return Math.round(confidence * 1000) / 1000;
}