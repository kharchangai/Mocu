import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { getAsyncLLM } from "../../../llm";
import { textSimilarity } from "../../textSimilarity";
import { buildFeedbackMemoryDecisionPrompt } from "./feedbackMemoryDecision.prompt";
import {
  FeedbackMemoryDecisionSchema,
  FeedbackMemorySchema,
  type FeedbackMemory,
  type FeedbackMemoryDecision,
  type SimilarFeedbackMemoryMatchForPrompt,
} from "./feedbackAnalysis.types";

const FEEDBACK_MEMORIES_DIRECTORY = "feedback-memories";
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_MAX_RESULTS = 10;

export type SimilarFeedbackMemoryMatch = {
  file_name: string;
  file_path: string;
  score: number;
  memory: FeedbackMemory;
};

export type FindSimilarFeedbackMemoriesOptions = {
  similarity_threshold?: number;
  max_results?: number;
  exclude_memory_id?: string;
};

export type FindSimilarFeedbackMemoriesResult = {
  matches: SimilarFeedbackMemoryMatch[];
  scanned_files_count: number;
  valid_memories_count: number;
};

export type FeedbackMemoryRecommendedAction =
  | "CREATE_NEW"
  | "APPEND_RECALL"
  | "SUSPEND_AND_CREATE";

export type FeedbackMemoryActionPlan = {
  action: FeedbackMemoryRecommendedAction;
  reasoning: string;
  recall_summary: string | null;

  target_memory_id: string | null;
  target_file_name: string | null;
  target_file_path: string | null;
  target_memory: FeedbackMemory | null;

  new_memory_should_be_saved: boolean;
  target_memory_should_receive_recall: boolean;
  target_memory_should_be_suspended: boolean;
};

export type AnalyzeFeedbackMemoryActionResult = {
  action_plan: FeedbackMemoryActionPlan;
  decision: FeedbackMemoryDecision;
  similar_memories: SimilarFeedbackMemoryMatch[];
  scanned_files_count: number;
  valid_memories_count: number;
};

function validateOptions(
  options: FindSimilarFeedbackMemoriesOptions,
): Required<Omit<FindSimilarFeedbackMemoriesOptions, "exclude_memory_id">> {
  const similarityThreshold =
    options.similarity_threshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  const maxResults = options.max_results ?? DEFAULT_MAX_RESULTS;

  if (
    !Number.isFinite(similarityThreshold) ||
    similarityThreshold < -1 ||
    similarityThreshold > 1
  ) {
    throw new Error(
      "similarity_threshold must be a finite number between -1 and 1.",
    );
  }

  if (!Number.isInteger(maxResults) || maxResults < 1) {
    throw new Error("max_results must be a positive integer.");
  }

  return {
    similarity_threshold: similarityThreshold,
    max_results: maxResults,
  };
}

function isJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".json");
}

function getFilePath(fileName: string): string {
  return `${FEEDBACK_MEMORIES_DIRECTORY}/${fileName}`;
}

function removeMarkdownCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

async function readFeedbackMemoryFromFile(
  fileName: string,
): Promise<FeedbackMemory | null> {
  try {
    const content = await readTextFile(getFilePath(fileName), {
      baseDir: BaseDirectory.AppData,
    });

    const parsedJson: unknown = JSON.parse(content);

    const validationResult = FeedbackMemorySchema.safeParse(parsedJson);

    if (!validationResult.success) {
      console.warn(
        `Skipping invalid feedback memory file: ${fileName}`,
        z.flattenError(validationResult.error),
      );

      return null;
    }

    return validationResult.data;
  } catch (error) {
    console.warn(`Failed to read feedback memory file: ${fileName}`, error);

    return null;
  }
}

async function getStoredFeedbackMemoryFiles(): Promise<string[]> {
  const directoryExists = await exists(FEEDBACK_MEMORIES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  if (!directoryExists) {
    return [];
  }

  const entries = await readDir(FEEDBACK_MEMORIES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  return entries
    .filter((entry) => entry.isFile && isJsonFile(entry.name))
    .map((entry) => entry.name);
}

function parseLlmDecision(
  rawResponse: string,
  candidateMemoryIds: Set<string>,
): FeedbackMemoryDecision {
  const cleanedResponse = removeMarkdownCodeFence(rawResponse);

  let parsedResponse: unknown;

  try {
    parsedResponse = JSON.parse(cleanedResponse);
  } catch {
    throw new Error(
      "The LLM returned invalid JSON for the feedback memory decision.",
    );
  }

  const decision = FeedbackMemoryDecisionSchema.parse(parsedResponse);

  if (
    decision.target_memory_id !== null &&
    !candidateMemoryIds.has(decision.target_memory_id)
  ) {
    throw new Error(
      `The LLM selected a memory ID that was not in the candidate list: ${decision.target_memory_id}`,
    );
  }

  return decision;
}

function createFallbackCreateNewDecision(): FeedbackMemoryDecision {
  return {
    decision: "CREATE_NEW",
    target_memory_id: null,
    reasoning:
      "No active stored feedback memory passed the similarity threshold.",
    recall_summary: null,
  };
}

function createActionPlan(
  decision: FeedbackMemoryDecision,
  targetMatch: SimilarFeedbackMemoryMatch | null,
): FeedbackMemoryActionPlan {
  if (decision.decision === "CREATE_NEW") {
    return {
      action: "CREATE_NEW",
      reasoning: decision.reasoning,
      recall_summary: null,

      target_memory_id: null,
      target_file_name: null,
      target_file_path: null,
      target_memory: null,

      new_memory_should_be_saved: true,
      target_memory_should_receive_recall: false,
      target_memory_should_be_suspended: false,
    };
  }

  if (!targetMatch) {
    throw new Error(
      `A target memory is required for decision: ${decision.decision}`,
    );
  }

  if (decision.decision === "APPEND_RECALL") {
    return {
      action: "APPEND_RECALL",
      reasoning: decision.reasoning,
      recall_summary: decision.recall_summary,

      target_memory_id: targetMatch.memory.id,
      target_file_name: targetMatch.file_name,
      target_file_path: targetMatch.file_path,
      target_memory: targetMatch.memory,

      new_memory_should_be_saved: false,
      target_memory_should_receive_recall: true,
      target_memory_should_be_suspended: false,
    };
  }

  return {
    action: "SUSPEND_AND_CREATE",
    reasoning: decision.reasoning,
    recall_summary: null,

    target_memory_id: targetMatch.memory.id,
    target_file_name: targetMatch.file_name,
    target_file_path: targetMatch.file_path,
    target_memory: targetMatch.memory,

    new_memory_should_be_saved: true,
    target_memory_should_receive_recall: false,
    target_memory_should_be_suspended: true,
  };
}

export async function findSimilarFeedbackMemories(
  newMemory: FeedbackMemory,
  options: FindSimilarFeedbackMemoriesOptions = {},
): Promise<FindSimilarFeedbackMemoriesResult> {
  const validatedNewMemory = FeedbackMemorySchema.parse(newMemory);
  const normalizedOptions = validateOptions(options);
  const fileNames = await getStoredFeedbackMemoryFiles();

  if (fileNames.length === 0) {
    return {
      matches: [],
      scanned_files_count: 0,
      valid_memories_count: 0,
    };
  }

  const storedMemoryEntries = await Promise.all(
    fileNames.map(async (fileName) => {
      const memory = await readFeedbackMemoryFromFile(fileName);

      if (!memory) {
        return null;
      }

      return {
        fileName,
        memory,
      };
    }),
  );

  const validMemoryEntries = storedMemoryEntries.filter(
    (
      entry,
    ): entry is {
      fileName: string;
      memory: FeedbackMemory;
    } => entry !== null,
  );

  const excludedMemoryId =
    options.exclude_memory_id ?? validatedNewMemory.id;

  const targetEmbeddings = validMemoryEntries
    .filter(
      (entry) =>
        entry.memory.id !== excludedMemoryId &&
        entry.memory.state === "active",
    )
    .map((entry) => ({
      id: entry.memory.id,
      embedding: entry.memory.combined_embedding,
    }));

  if (targetEmbeddings.length === 0) {
    return {
      matches: [],
      scanned_files_count: fileNames.length,
      valid_memories_count: validMemoryEntries.length,
    };
  }

  const comparison = textSimilarity.compareEmbeddingToList(
    validatedNewMemory.combined_embedding,
    targetEmbeddings,
  );

  const entriesByMemoryId = new Map(
    validMemoryEntries.map((entry) => [entry.memory.id, entry]),
  );

  const matches = comparison.matches
    .filter(
      (match) => match.score >= normalizedOptions.similarity_threshold,
    )
    .slice(0, normalizedOptions.max_results)
    .map((match) => {
      const entry = entriesByMemoryId.get(match.id);

      if (!entry) {
        throw new Error(
          `Could not find loaded memory for ID: ${match.id}`,
        );
      }

      return {
        file_name: entry.fileName,
        file_path: getFilePath(entry.fileName),
        score: match.score,
        memory: entry.memory,
      };
    });

  return {
    matches,
    scanned_files_count: fileNames.length,
    valid_memories_count: validMemoryEntries.length,
  };
}

export async function analyzeFeedbackMemoryDecision(
  newMemory: FeedbackMemory,
  matches: SimilarFeedbackMemoryMatch[],
): Promise<FeedbackMemoryDecision> {
  if (matches.length === 0) {
    return createFallbackCreateNewDecision();
  }

  const similarMemoriesForPrompt: SimilarFeedbackMemoryMatchForPrompt[] =
    matches.map((match) => ({
      file_name: match.file_name,
      similarity_score: match.score,
      memory: match.memory,
    }));

  const prompt = buildFeedbackMemoryDecisionPrompt({
    new_memory: newMemory,
    similar_memories: similarMemoriesForPrompt,
  });

  const llm = await getAsyncLLM("cheap");

  const response = await llm.invoke(prompt);

  const rawResponse =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  const candidateMemoryIds = new Set(
    matches.map((match) => match.memory.id),
  );

  return parseLlmDecision(rawResponse, candidateMemoryIds);
}

export async function analyzeFeedbackMemoryAction(
  newMemory: FeedbackMemory,
  options: FindSimilarFeedbackMemoriesOptions = {},
): Promise<AnalyzeFeedbackMemoryActionResult> {
  const validatedNewMemory = FeedbackMemorySchema.parse(newMemory);

  const similarMemoriesResult = await findSimilarFeedbackMemories(
    validatedNewMemory,
    options,
  );

  const decision = await analyzeFeedbackMemoryDecision(
    validatedNewMemory,
    similarMemoriesResult.matches,
  );

  const targetMatch =
    decision.target_memory_id === null
      ? null
      : similarMemoriesResult.matches.find(
          (match) => match.memory.id === decision.target_memory_id,
        ) ?? null;

  const actionPlan = createActionPlan(decision, targetMatch);

  return {
    action_plan: actionPlan,
    decision,
    similar_memories: similarMemoriesResult.matches,
    scanned_files_count: similarMemoriesResult.scanned_files_count,
    valid_memories_count: similarMemoriesResult.valid_memories_count,
  };
}