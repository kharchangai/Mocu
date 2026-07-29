import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  BaseDirectory,
  exists,
  mkdir,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { getAsyncLLM } from "../../../llm";
import { textSimilarity } from "../../textSimilarity";
import { analyzeFeedbackMemoryAction } from "./findSimilarFeedbackMemories";
import { FEEDBACK_ANALYSIS_SYSTEM_PROMPT } from "./prompts";
import {
  FeedbackAnalysisModelResultSchema,
  FeedbackMemorySchema,
  type FeedbackAnalysisInput,
  type FeedbackMemory,
} from "./feedbackAnalysis.types";

const FEEDBACK_MEMORIES_DIRECTORY = "feedback-memories";
const SIMILARITY_THRESHOLD = 0.7;
const MAX_SIMILAR_MEMORIES = 10;

const EMBEDDING_REPETITIONS = {
  scope_description: 5,
  problem_category: 3,
  task_type: 2,
  scope: 1,
} as const;

function validateInput(input: FeedbackAnalysisInput): void {
  if (!input.user_request?.trim()) {
    throw new Error("user_request cannot be empty.");
  }

  if (!input.agent_response?.trim()) {
    throw new Error("agent_response cannot be empty.");
  }

  if (!input.user_feedback?.trim()) {
    throw new Error("user_feedback cannot be empty.");
  }
}

function buildUserMessage(input: FeedbackAnalysisInput): string {
  return JSON.stringify(
    {
      user_request: input.user_request.trim(),
      agent_response: input.agent_response.trim(),
      user_feedback: input.user_feedback.trim(),
    },
    null,
    2,
  );
}

function createTimestamps(): {
  createdAt: string;
  activatedAt: string;
} {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    activatedAt: now,
  };
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") || "Not specified";
}

function repeatEmbeddingField(
  label: string,
  value: string,
  repetitions: number,
): string[] {
  return Array.from(
    { length: repetitions },
    () => `${label}: ${value}`,
  );
}

function createFeedbackMemoryEmbeddingText(input: {
  problemCategory: string;
  taskType: string;
  scope: string;
  scopeDescription: string;
}): string {
  const problemCategory = normalizeText(input.problemCategory);
  const taskType = normalizeText(input.taskType);
  const scope = normalizeText(input.scope);
  const scopeDescription = normalizeText(input.scopeDescription);

  return [
    "Memory retrieval profile:",
    "",
    "Primary activation context:",
    ...repeatEmbeddingField(
      "Scope description",
      scopeDescription,
      EMBEDDING_REPETITIONS.scope_description,
    ),
    "",
    "Problem classification:",
    ...repeatEmbeddingField(
      "Problem category",
      problemCategory,
      EMBEDDING_REPETITIONS.problem_category,
    ),
    "",
    "Task classification:",
    ...repeatEmbeddingField(
      "Task type",
      taskType,
      EMBEDDING_REPETITIONS.task_type,
    ),
    "",
    "Scope classification:",
    ...repeatEmbeddingField(
      "Scope",
      scope,
      EMBEDDING_REPETITIONS.scope,
    ),
  ].join("\n");
}

async function createFeedbackMemoryEmbedding(input: {
  problemCategory: string;
  taskType: string;
  scope: string;
  scopeDescription: string;
}): Promise<{
  text: string;
  vector: number[];
}> {
  const text = createFeedbackMemoryEmbeddingText(input);
  const vector = await textSimilarity.embedText(text);

  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("Failed to create a valid feedback memory embedding.");
  }

  return {
    text,
    vector,
  };
}

async function ensureFeedbackMemoriesDirectory(): Promise<void> {
  const directoryExists = await exists(FEEDBACK_MEMORIES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  if (directoryExists) {
    return;
  }

  await mkdir(FEEDBACK_MEMORIES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  });
}

async function saveFeedbackMemory(memory: FeedbackMemory): Promise<void> {
  await ensureFeedbackMemoriesDirectory();

  const filePath = `${FEEDBACK_MEMORIES_DIRECTORY}/${memory.id}.json`;

  await writeTextFile(filePath, JSON.stringify(memory, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

function logFeedbackMemoryAction(
  actionResult: Awaited<ReturnType<typeof analyzeFeedbackMemoryAction>>,
): void {
  if (actionResult.similar_memories.length === 0) {
    console.log("No similar feedback memories were found.");
    return;
  }

  console.log(
    "Similar feedback memories:",
    actionResult.similar_memories.map((match) => ({
      file_name: match.file_name,
      score: match.score,
      memory_id: match.memory.id,
      problem_category: match.memory.problem_category,
      task_type: match.memory.task_type,
      scope_description: match.memory.scope_description,
    })),
  );

  console.log("Feedback memory action plan:", {
    action: actionResult.action_plan.action,
    reasoning: actionResult.action_plan.reasoning,
    target_memory_id: actionResult.action_plan.target_memory_id,
    new_memory_should_be_saved:
      actionResult.action_plan.new_memory_should_be_saved,
    target_memory_should_receive_recall:
      actionResult.action_plan.target_memory_should_receive_recall,
    target_memory_should_be_suspended:
      actionResult.action_plan.target_memory_should_be_suspended,
  });
}

export async function analyzeFeedback(
  input: FeedbackAnalysisInput,
): Promise<FeedbackMemory> {
  validateInput(input);

  const llm = await getAsyncLLM("medium");

  const structuredLlm = llm.withStructuredOutput(
    FeedbackAnalysisModelResultSchema,
    {
      name: "feedback_analysis",
    },
  );

  const result = await structuredLlm.invoke([
    new SystemMessage(FEEDBACK_ANALYSIS_SYSTEM_PROMPT),
    new HumanMessage(buildUserMessage(input)),
  ]);

  const timestamps = createTimestamps();

  const embedding = await createFeedbackMemoryEmbedding({
    problemCategory: result.problem_category,
    taskType: result.task_type,
    scope: result.scope,
    scopeDescription: result.scope_description,
  });

  const memory = FeedbackMemorySchema.parse({
    ...result,

    id: crypto.randomUUID(),
    state: "active",

    created_at: timestamps.createdAt,
    activated_at: timestamps.activatedAt,

    suspended_at: null,
    suspension_reason: null,
    replaced_by_memory_id: null,

    combined_embedding: embedding.vector,
    embedding_text: embedding.text,

    embedding_metadata: {
      strategy: "weighted_text_repetition",
      field_priority: [
        "scope_description",
        "problem_category",
        "task_type",
        "scope",
      ],
      repetitions: EMBEDDING_REPETITIONS,
      generated_at: timestamps.createdAt,
    },

    source_interaction: {
      user_request: input.user_request.trim(),
      agent_response: input.agent_response.trim(),
      user_feedback: input.user_feedback.trim(),
    },
  });

  const actionResult = await analyzeFeedbackMemoryAction(memory, {
    similarity_threshold: SIMILARITY_THRESHOLD,
    max_results: MAX_SIMILAR_MEMORIES,
  });

  logFeedbackMemoryAction(actionResult);

  if (!actionResult.action_plan.new_memory_should_be_saved) {
    return memory;
  }

  await saveFeedbackMemory(memory);

  return memory;
}