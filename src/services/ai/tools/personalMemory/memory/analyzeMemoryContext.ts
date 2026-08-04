import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  BaseDirectory,
  exists,
  mkdir,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { getAsyncLLM } from "../../../llm";
import { textSimilarity } from "../../textSimilarity";
import { findMatchingFeedbackCondition } from "../candidate/findMatchingFeedbackCondition";
import { analyzeFeedbackMemoryAction } from "./findSimilarFeedbackMemories";
import { FEEDBACK_ANALYSIS_SYSTEM_PROMPT } from "./prompts";
import {
  FeedbackAnalysisModelResultSchema,
  FeedbackMemorySchema,
  type FeedbackAnalysisInput,
  type FeedbackMemory,
} from "./feedbackAnalysis.types";

const FEEDBACK_MEMORIES_DIRECTORY = "feedback-memories/memory";
const SIMILARITY_THRESHOLD = 0.7;
const MAX_SIMILAR_MEMORIES = 10;

const EMBEDDING_REPETITIONS = {
  scope_description: 5,
  problem_category: 3,
  task_type: 2,
  scope: 1,
} as const;

const CONDITION_EMBEDDING_REPETITIONS = {
  scope_description: 5,
  problem_category: 3,
  task_type: 2,
} as const;

/**
 * This instruction is appended to the main prompt so the model returns raw JSON only.
 *
 * withStructuredOutput is intentionally not used because some OpenAI-compatible
 * providers do not support tools or json_schema response formats.
 */
const JSON_OUTPUT_INSTRUCTION = `
IMPORTANT OUTPUT RULES:
- Return exactly one valid JSON object.
- Do not wrap the JSON in Markdown code fences.
- Do not write any explanation before or after the JSON.
- Use exactly the fields requested in the system prompt.
- Do not omit required fields.
- Make sure the response can be parsed directly with JSON.parse().
`.trim();

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

function buildSystemMessage(): string {
  return `${FEEDBACK_ANALYSIS_SYSTEM_PROMPT.trim()}

${JSON_OUTPUT_INSTRUCTION}`;
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

/**
 * Creates the embedding text used for feedback-memory similarity,
 * duplicate detection, and memory relationship analysis.
 */
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

/**
 * Creates the embedding text used to retrieve memories by activation condition.
 *
 * This embedding intentionally excludes scope and focuses on:
 * task type, problem category, and scope description.
 */
function createConditionEmbeddingText(input: {
  problemCategory: string;
  taskType: string;
  scopeDescription: string;
}): string {
  const problemCategory = normalizeText(input.problemCategory);
  const taskType = normalizeText(input.taskType);
  const scopeDescription = normalizeText(input.scopeDescription);

  return [
    "Feedback memory activation condition:",
    "",
    "Activation context:",
    ...repeatEmbeddingField(
      "Scope description",
      scopeDescription,
      CONDITION_EMBEDDING_REPETITIONS.scope_description,
    ),
    "",
    "Problem classification:",
    ...repeatEmbeddingField(
      "Problem category",
      problemCategory,
      CONDITION_EMBEDDING_REPETITIONS.problem_category,
    ),
    "",
    "Task classification:",
    ...repeatEmbeddingField(
      "Task type",
      taskType,
      CONDITION_EMBEDDING_REPETITIONS.task_type,
    ),
  ].join("\n");
}

function validateEmbeddingVector(
  vector: unknown,
  errorMessage: string,
): asserts vector is number[] {
  if (
    !Array.isArray(vector) ||
    vector.length === 0 ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(errorMessage);
  }
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

  validateEmbeddingVector(
    vector,
    "Failed to create a valid feedback memory embedding.",
  );

  return {
    text,
    vector,
  };
}

async function createConditionEmbedding(input: {
  problemCategory: string;
  taskType: string;
  scopeDescription: string;
}): Promise<{
  text: string;
  vector: number[];
}> {
  const text = createConditionEmbeddingText(input);
  const vector = await textSimilarity.embedText(text);

  validateEmbeddingVector(
    vector,
    "Failed to create a valid feedback memory condition embedding.",
  );

  return {
    text,
    vector,
  };
}

/**
 * Converts supported LangChain message content into plain text.
 */
function messageContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new Error(
      "The feedback analysis model returned an unsupported content format.",
    );
  }

  const text = content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (!item || typeof item !== "object") {
        return "";
      }

      const contentBlock = item as Record<string, unknown>;

      if (typeof contentBlock.text === "string") {
        return contentBlock.text;
      }

      return "";
    })
    .join("")
    .trim();

  if (!text) {
    throw new Error(
      "The feedback analysis model returned an empty response.",
    );
  }

  return text;
}

function removeMarkdownCodeFence(value: string): string {
  const trimmed = value.trim();

  const fencedJsonMatch = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/i,
  );

  if (fencedJsonMatch?.[1]) {
    return fencedJsonMatch[1].trim();
  }

  return trimmed;
}

/**
 * Extracts the first balanced JSON object from a string.
 * Braces inside JSON string values are ignored.
 */
function extractFirstJsonObject(value: string): string {
  const firstOpeningBrace = value.indexOf("{");

  if (firstOpeningBrace === -1) {
    throw new Error("No JSON object was found in the model response.");
  }

  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (
    let index = firstOpeningBrace;
    index < value.length;
    index += 1
  ) {
    const character = value[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        insideString = false;
      }

      continue;
    }

    if (character === '"') {
      insideString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return value.slice(firstOpeningBrace, index + 1);
      }
    }
  }

  throw new Error(
    "An incomplete JSON object was returned by the model.",
  );
}

function parseModelJsonResponse(responseText: string): unknown {
  const normalizedResponse = removeMarkdownCodeFence(responseText);

  if (!normalizedResponse) {
    throw new Error(
      "The feedback analysis model returned an empty response.",
    );
  }

  try {
    return JSON.parse(normalizedResponse);
  } catch {
    // Continue by attempting to extract the first JSON object.
  }

  let extractedJson: string;

  try {
    extractedJson = extractFirstJsonObject(normalizedResponse);
  } catch (error) {
    console.error("Feedback analysis raw response:", responseText);

    throw new Error(
      `The feedback analysis model did not return a JSON object. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    return JSON.parse(extractedJson);
  } catch (error) {
    console.error("Feedback analysis raw response:", responseText);
    console.error(
      "Extracted feedback analysis JSON:",
      extractedJson,
    );

    throw new Error(
      `The feedback analysis model returned invalid JSON. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Invokes the model without LangChain structured output.
 *
 * This avoids sending tools, function calling, or response_format=json_schema
 * to the provider.
 */
async function invokeFeedbackAnalysisModel(
  input: FeedbackAnalysisInput,
) {
  const llm = await getAsyncLLM("medium");

  try {
    const response = await llm.invoke([
      new SystemMessage(buildSystemMessage()),
      new HumanMessage(buildUserMessage(input)),
    ]);

    const responseText = messageContentToText(response.content);
    const parsedResponse = parseModelJsonResponse(responseText);

    return FeedbackAnalysisModelResultSchema.parse(parsedResponse);
  } catch (error) {
    console.error(
      "Feedback analysis model invocation failed:",
      error,
    );

    throw error;
  }
}

/**
 * Ensures that AppData/feedback-memories/memory exists.
 */
async function ensureFeedbackMemoriesDirectory(): Promise<void> {
  const directoryExists = await exists(
    FEEDBACK_MEMORIES_DIRECTORY,
    {
      baseDir: BaseDirectory.AppData,
    },
  );

  if (directoryExists) {
    return;
  }

  await mkdir(FEEDBACK_MEMORIES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  });
}

/**
 * Saves a feedback memory in AppData/feedback-memories/memory.
 */
async function saveFeedbackMemory(
  memory: FeedbackMemory,
): Promise<void> {
  await ensureFeedbackMemoriesDirectory();

  const filePath =
    `${FEEDBACK_MEMORIES_DIRECTORY}/${memory.id}.json`;

  await writeTextFile(
    filePath,
    JSON.stringify(memory, null, 2),
    {
      baseDir: BaseDirectory.AppData,
    },
  );
}

/**
 * Extracts condition_id from the condition lookup result.
 *
 * Both a raw string result and an object containing condition_id
 * are supported.
 */
function extractConditionId(conditionResult: unknown): string {
  if (
    typeof conditionResult === "string" &&
    conditionResult.trim()
  ) {
    return conditionResult.trim();
  }

  if (!conditionResult || typeof conditionResult !== "object") {
    throw new Error(
      "findMatchingFeedbackCondition returned an invalid result.",
    );
  }

  const result = conditionResult as Record<string, unknown>;

  if (
    typeof result.condition_id === "string" &&
    result.condition_id.trim()
  ) {
    return result.condition_id.trim();
  }

  if (
    typeof result.conditionId === "string" &&
    result.conditionId.trim()
  ) {
    return result.conditionId.trim();
  }

  if (
    result.condition &&
    typeof result.condition === "object"
  ) {
    const condition = result.condition as Record<string, unknown>;

    if (
      typeof condition.id === "string" &&
      condition.id.trim()
    ) {
      return condition.id.trim();
    }
  }

  throw new Error(
    "findMatchingFeedbackCondition did not return a valid condition_id.",
  );
}

/**
 * Increments and persists recall_count for the selected existing memory.
 */
async function incrementTargetMemoryRecallCount(
  actionResult: Awaited<
    ReturnType<typeof analyzeFeedbackMemoryAction>
  >,
): Promise<void> {
  const {
    target_memory_id,
    target_memory_should_receive_recall,
  } = actionResult.action_plan;

  if (
    !target_memory_should_receive_recall ||
    !target_memory_id
  ) {
    return;
  }

  const targetMatch = actionResult.similar_memories.find(
    (match) => match.memory.id === target_memory_id,
  );

  if (!targetMatch) {
    throw new Error(
      `Could not find the recall target memory: ${target_memory_id}`,
    );
  }

  const updatedTargetMemory = FeedbackMemorySchema.parse({
    ...targetMatch.memory,
    recall_count: targetMatch.memory.recall_count + 1,
  });

  await saveFeedbackMemory(updatedTargetMemory);

  console.log("Feedback memory recall count updated:", {
    memory_id: updatedTargetMemory.id,
    recall_count: updatedTargetMemory.recall_count,
  });
}

function logFeedbackMemoryAction(
  actionResult: Awaited<
    ReturnType<typeof analyzeFeedbackMemoryAction>
  >,
): void {
  if (actionResult.similar_memories.length === 0) {
    console.log("No similar feedback memories were found.");

    console.log("Feedback memory action plan:", {
      action: actionResult.action_plan.action,
      reasoning: actionResult.action_plan.reasoning,
      target_memory_id:
        actionResult.action_plan.target_memory_id,
      new_memory_should_be_saved:
        actionResult.action_plan.new_memory_should_be_saved,
      target_memory_should_receive_recall:
        actionResult.action_plan
          .target_memory_should_receive_recall,
      target_memory_should_be_suspended:
        actionResult.action_plan
          .target_memory_should_be_suspended,
    });

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
      recall_count: match.memory.recall_count,
    })),
  );

  console.log("Feedback memory action plan:", {
    action: actionResult.action_plan.action,
    reasoning: actionResult.action_plan.reasoning,
    target_memory_id:
      actionResult.action_plan.target_memory_id,
    new_memory_should_be_saved:
      actionResult.action_plan.new_memory_should_be_saved,
    target_memory_should_receive_recall:
      actionResult.action_plan
        .target_memory_should_receive_recall,
    target_memory_should_be_suspended:
      actionResult.action_plan
        .target_memory_should_be_suspended,
  });
}

export async function analyzeFeedback(
  input: FeedbackAnalysisInput,
): Promise<FeedbackMemory> {
  validateInput(input);

  const result = await invokeFeedbackAnalysisModel(input);
  const timestamps = createTimestamps();

  const [embedding, conditionEmbedding] = await Promise.all([
    createFeedbackMemoryEmbedding({
      problemCategory: result.problem_category,
      taskType: result.task_type,
      scope: result.scope,
      scopeDescription: result.scope_description,
    }),

    createConditionEmbedding({
      problemCategory: result.problem_category,
      taskType: result.task_type,
      scopeDescription: result.scope_description,
    }),
  ]);

  /**
   * Create the base object without parsing it as FeedbackMemory yet.
   * condition_id is obtained and added before final schema validation.
   */
  const memoryData = {
    ...result,

    id: crypto.randomUUID(),
    state: "active" as const,

    recall_count: 0,
    recalls: [],

    created_at: timestamps.createdAt,
    activated_at: timestamps.activatedAt,

    suspended_at: null,
    suspension_reason: null,
    replaced_by_memory_id: null,

    combined_embedding: embedding.vector,
    embedding_text: embedding.text,

    embedding_metadata: {
      strategy: "weighted_text_repetition" as const,

      field_priority: [
        "scope_description",
        "problem_category",
        "task_type",
        "scope",
      ],

      repetitions: EMBEDDING_REPETITIONS,
      generated_at: timestamps.createdAt,
    },

    condition_embedding: conditionEmbedding.vector,
    condition_embedding_text: conditionEmbedding.text,

    condition_embedding_metadata: {
      strategy: "weighted_text_repetition" as const,

      field_priority: [
        "scope_description",
        "problem_category",
        "task_type",
      ],

      repetitions: CONDITION_EMBEDDING_REPETITIONS,
      generated_at: timestamps.createdAt,
    },

    source_interaction: {
      user_request: input.user_request.trim(),
      agent_response: input.agent_response.trim(),
      user_feedback: input.user_feedback.trim(),
    },
  };

  /**
   * Find an existing matching condition or create a new condition.
   * The function must return either condition_id or the ID directly.
   */
  const conditionResult =
    await findMatchingFeedbackCondition({
      user_request: input.user_request.trim(),
      agent_response: input.agent_response.trim(),
      user_feedback: input.user_feedback.trim(),

      feedback_analysis: result,

      problem_category: result.problem_category,
      task_type: result.task_type,
      scope: result.scope,
      scope_description: result.scope_description,

      condition_embedding: conditionEmbedding.vector,
      condition_embedding_text: conditionEmbedding.text,
    });

  const conditionId = extractConditionId(conditionResult);

  /**
   * Add condition_id before parsing and saving the memory.
   */
  const memory = FeedbackMemorySchema.parse({
    ...memoryData,
    condition_id: conditionId,
  });

  const actionResult = await analyzeFeedbackMemoryAction(
    memory,
    {
      similarity_threshold: SIMILARITY_THRESHOLD,
      max_results: MAX_SIMILAR_MEMORIES,
    },
  );

  logFeedbackMemoryAction(actionResult);

  if (actionResult.action_plan.new_memory_should_be_saved) {
    await saveFeedbackMemory(memory);

    console.log("New feedback memory saved:", {
      memory_id: memory.id,
      condition_id: memory.condition_id,
    });
  }

  await incrementTargetMemoryRecallCount(actionResult);

  return memory;
}