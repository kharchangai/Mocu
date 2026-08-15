import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { getAsyncLLM } from "../../../llm";
import { textSimilarity } from "../../textSimilarity";
import { buildConditionCandidate } from "./buildCandidate";
import {
  buildFeedbackConditionSelectionPrompt,
  type FeedbackAnalysisForConditionSelection,
  type FeedbackConditionCandidateForPrompt,
} from "./feedbackConditionSelection.prompt";

const FEEDBACK_CONDITIONS_DIRECTORY =
  "feedback-memories/condition";

const DEFAULT_SIMILARITY_THRESHOLD = 0.5;
const DEFAULT_MAX_LLM_CANDIDATES = 5;

const NonEmptyStringSchema = z
  .string()
  .trim()
  .min(1, {
    error: "Value cannot be empty.",
  });

const EmbeddingSchema = z
  .array(z.number().finite())
  .min(1, {
    error: "Embedding must contain at least one number.",
  });

const ConditionStateSchema = z.enum([
  "active",
  "suspended",
  "superseded",
]);

/**
 * A reference from a condition to a separately stored policy file.
 */
const AtomicPolicyReferenceSchema = z.object({
  atomic_policy: NonEmptyStringSchema,
  policy_id: NonEmptyStringSchema,
});

/**
 * This is the result returned by createMainAgentPolicies through
 * buildConditionCandidate.
 */
const MainAgentPoliciesResultSchema = z.object({
  atomic_policies: z.array(
    AtomicPolicyReferenceSchema,
  ),
});

/**
 * Old condition files may not contain atomic_policies.
 * The default value preserves backward compatibility.
 */
const StoredFeedbackConditionSchema = z.looseObject({
  id: NonEmptyStringSchema,

  state: ConditionStateSchema.default(
    "active",
  ),

  activation_description:
    NonEmptyStringSchema,

  problem_summary:
    NonEmptyStringSchema.optional(),

  problem_category:
    NonEmptyStringSchema,

  task_type:
    NonEmptyStringSchema,

  scope:
    NonEmptyStringSchema.optional(),

  scope_description:
    NonEmptyStringSchema,

  atomic_policies: z
    .array(
      AtomicPolicyReferenceSchema,
    )
    .default([]),

  condition_embedding:
    EmbeddingSchema,
});

/**
 * The interaction fields are required because
 * buildConditionCandidate uses them to generate policies.
 */
const AnalyzeFeedbackConditionInputSchema =
  z.looseObject({
    user_request:
      NonEmptyStringSchema,

    agent_response:
      NonEmptyStringSchema,

    user_feedback:
      NonEmptyStringSchema,

    problem_summary:
      NonEmptyStringSchema.optional(),

    problem_category:
      NonEmptyStringSchema,

    task_type:
      NonEmptyStringSchema,

    scope:
      NonEmptyStringSchema.optional(),

    scope_description:
      NonEmptyStringSchema,

    domain:
      NonEmptyStringSchema.optional(),

    topic:
      NonEmptyStringSchema.optional(),

    content_type:
      NonEmptyStringSchema.optional(),

    project_id:
      NonEmptyStringSchema.optional(),

    condition_embedding:
      EmbeddingSchema,
  });

const LlmConditionSelectionSchema =
  z.object({
    selected_condition_id:
      NonEmptyStringSchema,

    reasoning:
      NonEmptyStringSchema,
  });

/**
 * The candidate now contains the output of
 * createMainAgentPolicies.
 */
const ConditionCandidateSchema =
  z.looseObject({
    activationDescription:
      NonEmptyStringSchema,

    scope:
      NonEmptyStringSchema.optional(),

    mainAgentPolicies:
      MainAgentPoliciesResultSchema,
  });

export type AtomicPolicyReference =
  z.infer<
    typeof AtomicPolicyReferenceSchema
  >;

export type MainAgentPoliciesResult =
  z.infer<
    typeof MainAgentPoliciesResultSchema
  >;

export type StoredFeedbackCondition =
  z.infer<
    typeof StoredFeedbackConditionSchema
  >;

export type AnalyzeFeedbackConditionInput =
  z.infer<
    typeof AnalyzeFeedbackConditionInputSchema
  >;

export type LlmConditionSelection =
  z.infer<
    typeof LlmConditionSelectionSchema
  >;

export type ConditionCandidate =
  z.infer<
    typeof ConditionCandidateSchema
  >;

export type SimilarFeedbackConditionMatch = {
  condition_id: string;
  file_name: string;
  file_path: string;
  similarity_score: number;
  condition: StoredFeedbackCondition;
};

export type FindMatchingFeedbackConditionOptions = {
  similarity_threshold?: number;
  max_llm_candidates?: number;
};

type LoadedFeedbackCondition = {
  file_name: string;
  file_path: string;
  condition: StoredFeedbackCondition;
};

function isJsonFile(
  fileName: string,
): boolean {
  return fileName
    .toLowerCase()
    .endsWith(".json");
}

function getConditionFilePath(
  fileName: string,
): string {
  return `${FEEDBACK_CONDITIONS_DIRECTORY}/${fileName}`;
}

function removeMarkdownCodeFence(
  value: string,
): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function validateSimilarityThreshold(
  threshold: number,
): number {
  if (
    !Number.isFinite(threshold) ||
    threshold < -1 ||
    threshold > 1
  ) {
    throw new Error(
      "similarity_threshold must be a finite number between -1 and 1.",
    );
  }

  return threshold;
}

function validateMaxLlmCandidates(
  maxCandidates: number,
): number {
  if (
    !Number.isInteger(maxCandidates) ||
    maxCandidates < 1 ||
    maxCandidates > 5
  ) {
    throw new Error(
      "max_llm_candidates must be an integer between 1 and 5.",
    );
  }

  return maxCandidates;
}

function haveSameEmbeddingDimensions(
  firstEmbedding: number[],
  secondEmbedding: number[],
): boolean {
  return (
    firstEmbedding.length ===
    secondEmbedding.length
  );
}

function createConditionId(): string {
  if (
    typeof globalThis.crypto ===
      "undefined" ||
    typeof globalThis.crypto.randomUUID !==
      "function"
  ) {
    throw new Error(
      "crypto.randomUUID is not available.",
    );
  }

  return globalThis.crypto.randomUUID();
}

async function ensureConditionDirectory():
  Promise<void> {
  const directoryExists = await exists(
    FEEDBACK_CONDITIONS_DIRECTORY,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  if (directoryExists) {
    return;
  }

  await mkdir(
    FEEDBACK_CONDITIONS_DIRECTORY,
    {
      baseDir:
        BaseDirectory.AppData,
      recursive: true,
    },
  );
}

async function getStoredConditionFileNames():
  Promise<string[]> {
  const directoryExists = await exists(
    FEEDBACK_CONDITIONS_DIRECTORY,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  if (!directoryExists) {
    return [];
  }

  const entries = await readDir(
    FEEDBACK_CONDITIONS_DIRECTORY,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  return entries
    .filter(
      (entry) =>
        entry.isFile &&
        isJsonFile(entry.name),
    )
    .map((entry) => entry.name);
}

async function readStoredConditionFile(
  fileName: string,
): Promise<LoadedFeedbackCondition | null> {
  const filePath =
    getConditionFilePath(fileName);

  try {
    const content = await readTextFile(
      filePath,
      {
        baseDir:
          BaseDirectory.AppData,
      },
    );

    const parsedJson: unknown =
      JSON.parse(content);

    const validationResult =
      StoredFeedbackConditionSchema.safeParse(
        parsedJson,
      );

    if (!validationResult.success) {
      console.warn(
        `Skipping invalid feedback condition file: ${fileName}`,
        z.flattenError(
          validationResult.error,
        ),
      );

      return null;
    }

    return {
      file_name: fileName,
      file_path: filePath,
      condition:
        validationResult.data,
    };
  } catch (error) {
    console.warn(
      `Failed to read feedback condition file: ${fileName}`,
      error,
    );

    return null;
  }
}

async function readAllStoredConditions():
  Promise<LoadedFeedbackCondition[]> {
  const fileNames =
    await getStoredConditionFileNames();

  if (fileNames.length === 0) {
    return [];
  }

  const loadedConditions =
    await Promise.all(
      fileNames.map((fileName) =>
        readStoredConditionFile(
          fileName,
        ),
      ),
    );

  return loadedConditions.filter(
    (
      condition,
    ): condition is LoadedFeedbackCondition =>
      condition !== null,
  );
}

function findSimilarConditions(
  input: AnalyzeFeedbackConditionInput,
  loadedConditions:
    LoadedFeedbackCondition[],
  similarityThreshold: number,
): SimilarFeedbackConditionMatch[] {
  const comparableConditions =
    loadedConditions.filter(
      ({
        condition,
        file_name: fileName,
      }) => {
        if (
          condition.state !==
          "active"
        ) {
          return false;
        }

        const dimensionsMatch =
          haveSameEmbeddingDimensions(
            input.condition_embedding,
            condition.condition_embedding,
          );

        if (!dimensionsMatch) {
          console.warn(
            `Skipping condition with incompatible embedding dimensions: ${fileName}`,
          );
        }

        return dimensionsMatch;
      },
    );

  if (
    comparableConditions.length ===
    0
  ) {
    return [];
  }

  const conditionsById =
    new Map<
      string,
      LoadedFeedbackCondition
    >();

  for (
    const loadedCondition of comparableConditions
  ) {
    const conditionId =
      loadedCondition.condition.id;

    if (
      conditionsById.has(
        conditionId,
      )
    ) {
      console.warn(
        `Duplicate feedback condition ID detected: ${conditionId}`,
      );

      continue;
    }

    conditionsById.set(
      conditionId,
      loadedCondition,
    );
  }

  const targetEmbeddings =
    Array.from(
      conditionsById.values(),
    ).map(({ condition }) => ({
      id: condition.id,
      embedding:
        condition.condition_embedding,
    }));

  if (
    targetEmbeddings.length === 0
  ) {
    return [];
  }

  const comparison =
    textSimilarity.compareEmbeddingToList(
      input.condition_embedding,
      targetEmbeddings,
    );

  return comparison.matches
    .filter(
      (match) =>
        match.score >
        similarityThreshold,
    )
    .map((match) => {
      const loadedCondition =
        conditionsById.get(
          match.id,
        );

      if (!loadedCondition) {
        throw new Error(
          `Could not find the loaded condition for ID: ${match.id}`,
        );
      }

      return {
        condition_id:
          loadedCondition.condition.id,

        file_name:
          loadedCondition.file_name,

        file_path:
          loadedCondition.file_path,

        similarity_score:
          match.score,

        condition:
          loadedCondition.condition,
      };
    })
    .sort(
      (first, second) =>
        second.similarity_score -
        first.similarity_score,
    );
}

function createFeedbackAnalysisForPrompt(
  input: AnalyzeFeedbackConditionInput,
): FeedbackAnalysisForConditionSelection {
  return {
    problem_summary:
      input.problem_summary ?? null,

    problem_category:
      input.problem_category,

    task_type:
      input.task_type,

    scope:
      input.scope ?? null,

    scope_description:
      input.scope_description,
  };
}

function createConditionCandidateForPrompt(
  match: SimilarFeedbackConditionMatch,
): FeedbackConditionCandidateForPrompt {
  return {
    condition_id:
      match.condition_id,

    similarity_score:
      Math.round(
        match.similarity_score *
          10_000,
      ) / 10_000,

    problem_summary:
      match.condition
        .problem_summary ?? null,

    problem_category:
      match.condition
        .problem_category,

    task_type:
      match.condition.task_type,

    scope:
      match.condition.scope ?? null,

    scope_description:
      match.condition
        .scope_description,
  };
}

function parseLlmConditionSelection(
  rawResponse: string,
  candidateIds: Set<string>,
): LlmConditionSelection {
  const cleanedResponse =
    removeMarkdownCodeFence(
      rawResponse,
    );

  let parsedResponse: unknown;

  try {
    parsedResponse = JSON.parse(
      cleanedResponse,
    );
  } catch {
    throw new Error(
      "The LLM returned invalid JSON while selecting a feedback condition.",
    );
  }

  const selection =
    LlmConditionSelectionSchema.parse(
      parsedResponse,
    );

  if (
    !candidateIds.has(
      selection.selected_condition_id,
    )
  ) {
    throw new Error(
      `The LLM selected a condition ID outside the candidate list: ${selection.selected_condition_id}`,
    );
  }

  return selection;
}

async function selectConditionWithLlm(
  input: AnalyzeFeedbackConditionInput,
  candidates:
    SimilarFeedbackConditionMatch[],
): Promise<LlmConditionSelection> {
  const feedbackAnalysisForPrompt =
    createFeedbackAnalysisForPrompt(
      input,
    );

  const candidateConditionsForPrompt =
    candidates.map(
      createConditionCandidateForPrompt,
    );

  const prompt =
    buildFeedbackConditionSelectionPrompt(
      {
        feedback_analysis:
          feedbackAnalysisForPrompt,

        candidate_conditions:
          candidateConditionsForPrompt,
      },
    );

  const llm =
    await getAsyncLLM("cheap");

  const response =
    await llm.invoke(prompt);

  const rawResponse =
    typeof response.content ===
    "string"
      ? response.content
      : JSON.stringify(
          response.content,
        );

  const candidateIds =
    new Set(
      candidates.map(
        (candidate) =>
          candidate.condition_id,
      ),
    );

  return parseLlmConditionSelection(
    rawResponse,
    candidateIds,
  );
}

/**
 * Creates a condition candidate, creates and stores its missing
 * policy files, and stores references to all policies in the
 * condition file.
 */
async function createAndStoreCondition(
  input: AnalyzeFeedbackConditionInput,
): Promise<string> {
  /*
   * buildConditionCandidate calls generateAtomicPolicy and
   * createMainAgentPolicies. Missing policy files are stored
   * before this function continues.
   */
  const rawCandidate =
    await buildConditionCandidate({
      user_request:
        input.user_request,

      agent_response:
        input.agent_response,

      user_feedback:
        input.user_feedback,

      ...(input.problem_summary
        ? {
            problem_summary:
              input.problem_summary,
          }
        : {}),

      problem_category:
        input.problem_category,

      task_type:
        input.task_type,

      ...(input.scope
        ? {
            scope:
              input.scope,
          }
        : {}),

      scope_description:
        input.scope_description,

      ...(input.domain
        ? {
            domain:
              input.domain,
          }
        : {}),

      ...(input.topic
        ? {
            topic:
              input.topic,
          }
        : {}),

      ...(input.content_type
        ? {
            content_type:
              input.content_type,
          }
        : {}),

      ...(input.project_id
        ? {
            project_id:
              input.project_id,
          }
        : {}),
    });

  const candidate =
    ConditionCandidateSchema.parse(
      rawCandidate,
    );

  const atomicPolicies =
    candidate
      .mainAgentPolicies
      .atomic_policies;

  const conditionId =
    createConditionId();

  /*
   * The input condition_embedding is used only for finding an
   * existing condition. A stable embedding is generated for the
   * newly stored condition using the final activation description.
   */
  const conditionEmbedding =
    await textSimilarity.embedMemory({
      content:
        candidate.activationDescription,

      context:
        input.scope_description,

      key: [
        input.task_type,
      ],

      tags: [
        input.problem_category,
      ],
    });

  const storedCondition =
    StoredFeedbackConditionSchema.parse({
      id:
        conditionId,

      state:
        "active",

      activation_description:
        candidate.activationDescription,

      ...(input.problem_summary
        ? {
            problem_summary:
              input.problem_summary,
          }
        : {}),

      problem_category:
        input.problem_category,

      task_type:
        input.task_type,

      ...(candidate.scope
        ? {
            scope:
              candidate.scope,
          }
        : input.scope
          ? {
              scope:
                input.scope,
            }
          : {}),

      scope_description:
        input.scope_description,

      /*
       * These references connect this condition to the policy
       * files stored in feedback-memories/policy.
       */
      atomic_policies:
        atomicPolicies,

      condition_embedding:
        conditionEmbedding,
    });

  await ensureConditionDirectory();

  const fileName =
    `${conditionId}.json`;

  const filePath =
    getConditionFilePath(fileName);

  try {
    await writeTextFile(
      filePath,
      `${JSON.stringify(
        storedCondition,
        null,
        2,
      )}\n`,
      {
        baseDir:
          BaseDirectory.AppData,
      },
    );
  } catch (error) {
    throw new Error(
      `Failed to store feedback condition file "${fileName}".`
    );
  }

  console.log(
    "Stored feedback condition:",
    JSON.stringify(
      storedCondition,
      null,
      2,
    ),
  );

  return conditionId;
}

/**
 * Returns an existing matching condition ID.
 *
 * If no matching condition exists, this function:
 * 1. Builds a new condition candidate.
 * 2. Generates and resolves its policies.
 * 3. Stores missing policy files.
 * 4. Stores policy references inside the condition file.
 * 5. Returns the new condition ID.
 */
export async function findMatchingFeedbackCondition(
  analyzeFeedbackResult:
    AnalyzeFeedbackConditionInput,
  options:
    FindMatchingFeedbackConditionOptions = {},
): Promise<string> {
  const validatedInput =
    AnalyzeFeedbackConditionInputSchema.parse(
      analyzeFeedbackResult,
    );

  const similarityThreshold =
    validateSimilarityThreshold(
      options.similarity_threshold ??
        DEFAULT_SIMILARITY_THRESHOLD,
    );

  const maxLlmCandidates =
    validateMaxLlmCandidates(
      options.max_llm_candidates ??
        DEFAULT_MAX_LLM_CANDIDATES,
    );

  const loadedConditions =
    await readAllStoredConditions();

  if (
    loadedConditions.length === 0
  ) {
    return createAndStoreCondition(
      validatedInput,
    );
  }

  const similarConditions =
    findSimilarConditions(
      validatedInput,
      loadedConditions,
      similarityThreshold,
    );

  if (
    similarConditions.length === 0
  ) {
    return createAndStoreCondition(
      validatedInput,
    );
  }

  if (
    similarConditions.length === 1
  ) {
    return similarConditions[0]
      .condition_id;
  }

  const topCandidates =
    similarConditions.slice(
      0,
      maxLlmCandidates,
    );

  try {
    const selection =
      await selectConditionWithLlm(
        validatedInput,
        topCandidates,
      );

    return selection
      .selected_condition_id;
  } catch (error) {
    console.warn(
      "The LLM condition selection failed. Falling back to the candidate with the highest similarity score.",
      error,
    );

    return topCandidates[0]
      .condition_id;
  }
}