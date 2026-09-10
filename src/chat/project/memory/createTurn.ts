import { createAgentSpans } from "./createSpans";
import { createTurnIndexPrompt } from "./prompts/turnIndexPrompt";

import { getAsyncLLM } from "../../../services/ai/llm";
import { textSimilarity } from "../../../services/ai/tools/textSimilarity";
import { databaseManager } from "./storage/databaseManager";
import { entityMemoryStore } from "./memory-retrieval/entityMemoryStore";

export type TurnType =
  | "question"
  | "explanation"
  | "instruction"
  | "decision"
  | "preference"
  | "correction"
  | "problem"
  | "solution"
  | "planning"
  | "feedback"
  | "tool_result"
  | "casual"
  | "other";

export type EntityType =
  | "person"
  | "organization"
  | "location"
  | "technology"
  | "package"
  | "file"
  | "function"
  | "project"
  | "product"
  | "date"
  | "other";

export interface TurnEntity {
  text: string;
  normalized: string;
  type: EntityType;
}

export interface ExtractedTurnMetadata {
  subject: string;
  keywords: string[];
  entities: TurnEntity[];
  turnType: TurnType;
}

export interface TurnSpan {
  tag: string;
  type: string;
  content: string;
  estimatedTokenCount: number;
  languages?: string[];
}

export interface SpanEmbedding {
  spanIndex: number;
  tag: string;
  embedding: number[];
}

export interface TurnIndexes {
  subject: string;
  keywords: string[];
  entities: TurnEntity[];

  /**
   * Semantic type of the Turn.
   */
  type: TurnType;

  /**
   * Kept for compatibility with existing index consumers.
   */
  turnType: TurnType;

  /**
   * Semantic embedding of the complete Turn.
   */
  embedding: number[];

  /**
   * Semantic embeddings of individual agent spans.
   */
  spanEmbeddings: SpanEmbedding[];

  /**
   * Approximate token count of the complete Turn.
   */
  estimatedTokenCount: number;

  /**
   * Kept for compatibility with existing index consumers.
   */
  createdAt: string;
}

export interface Turn {
  /**
   * Stable identifier generated before database insertion.
   */
  id: string;

  userMessage: string;
  agentResponse: string;
  spans: TurnSpan[];
  indexes: TurnIndexes;

  /**
   * Approximate token count of the complete Turn.
   */
  estimatedTokens: number;

  /**
   * Creation time of the Turn.
   */
  createdAt: string;
}

export interface CreateTurnResult {
  turnId: string;
  turn: Turn;
}

const ALLOWED_TURN_TYPES = new Set<TurnType>([
  "question",
  "explanation",
  "instruction",
  "decision",
  "preference",
  "correction",
  "problem",
  "solution",
  "planning",
  "feedback",
  "tool_result",
  "casual",
  "other",
]);

const ALLOWED_ENTITY_TYPES = new Set<EntityType>([
  "person",
  "organization",
  "location",
  "technology",
  "package",
  "file",
  "function",
  "project",
  "product",
  "date",
  "other",
]);

/**
 * Creates a Turn, stores it in the database,
 * and returns both its ID and complete data.
 */
export async function createTurn(
  userMessage: string,
  agentResponse: string,
): Promise<CreateTurnResult> {
  const cleanUserMessage = normalizeRequiredInput(
    userMessage,
    "userMessage",
  );

  const cleanAgentResponse = normalizeRequiredInput(
    agentResponse,
    "agentResponse",
  );

  const turnId = createTurnId();
  const createdAt = new Date().toISOString();

  const spans = normalizeSpans(
    createAgentSpans(cleanAgentResponse),
  );

  const [metadata, embedding, spanEmbeddings] =
    await Promise.all([
      extractTurnMetadata(
        cleanUserMessage,
        cleanAgentResponse,
      ),

      createEmbedding(
        createTurnEmbeddingText(
          cleanUserMessage,
          cleanAgentResponse,
        ),
      ),

      createSpanEmbeddings(spans),
    ]);

  const estimatedTokenCount = estimateTokenCount(
    `${cleanUserMessage}\n\n${cleanAgentResponse}`,
  );

  const turn: Turn = {
    id: turnId,
    userMessage: cleanUserMessage,
    agentResponse: cleanAgentResponse,
    spans,
    createdAt,
    estimatedTokens: estimatedTokenCount,

    indexes: {
      subject: metadata.subject,
      keywords: metadata.keywords,

      /**
       * These entities have already been resolved against
       * the SQLite entity memory.
       */
      entities: metadata.entities,

      type: metadata.turnType,
      turnType: metadata.turnType,
      embedding,
      spanEmbeddings,
      estimatedTokenCount,
      createdAt,
    },
  };

  assertValidCreatedTurn(turn);

  await databaseManager.save<Turn>({
    type: "turn",
    key: turnId,
    data: turn,
  });

  return {
    turnId,
    turn,
  };
}

/**
 * Generates a unique and stable Turn ID.
 */
function createTurnId(): string {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  throw new Error(
    "crypto.randomUUID is not available in this environment.",
  );
}

/**
 * Validates a Turn before it is saved and returned.
 */
function assertValidCreatedTurn(
  turn: Turn,
): void {
  if (!turn.id.trim()) {
    throw new Error(
      "Turn id cannot be empty.",
    );
  }

  if (!turn.userMessage.trim()) {
    throw new Error(
      "Turn userMessage cannot be empty.",
    );
  }

  if (!turn.agentResponse.trim()) {
    throw new Error(
      "Turn agentResponse cannot be empty.",
    );
  }

  if (!isValidIsoDateString(turn.createdAt)) {
    throw new Error(
      "Turn createdAt must be a valid ISO date string.",
    );
  }

  if (
    !isValidIsoDateString(
      turn.indexes.createdAt,
    )
  ) {
    throw new Error(
      "Turn indexes.createdAt must be a valid ISO date string.",
    );
  }

  if (
    !ALLOWED_TURN_TYPES.has(
      turn.indexes.type,
    )
  ) {
    throw new Error(
      "Turn indexes.type is invalid.",
    );
  }

  if (
    turn.indexes.turnType !==
    turn.indexes.type
  ) {
    throw new Error(
      "Turn indexes.turnType must match indexes.type.",
    );
  }

  if (
    !Number.isFinite(
      turn.estimatedTokens,
    ) ||
    turn.estimatedTokens < 0
  ) {
    throw new Error(
      "Turn estimatedTokens must be a non-negative finite number.",
    );
  }

  if (
    !Number.isFinite(
      turn.indexes.estimatedTokenCount,
    ) ||
    turn.indexes.estimatedTokenCount < 0
  ) {
    throw new Error(
      "Turn indexes.estimatedTokenCount must be a non-negative finite number.",
    );
  }

  assertValidEmbedding(
    turn.indexes.embedding,
    "Turn embedding",
  );

  for (
    let index = 0;
    index < turn.indexes.spanEmbeddings.length;
    index += 1
  ) {
    const spanEmbedding =
      turn.indexes.spanEmbeddings[index];

    if (
      !Number.isInteger(
        spanEmbedding.spanIndex,
      ) ||
      spanEmbedding.spanIndex < 0 ||
      spanEmbedding.spanIndex >=
        turn.spans.length
    ) {
      throw new Error(
        `Span embedding at index ${index} has an invalid spanIndex.`,
      );
    }

    assertValidEmbedding(
      spanEmbedding.embedding,
      `Span embedding at index ${index}`,
    );
  }

  for (
    let index = 0;
    index < turn.indexes.entities.length;
    index += 1
  ) {
    const entity =
      turn.indexes.entities[index];

    if (!entity.text.trim()) {
      throw new Error(
        `Entity at index ${index} has an empty text value.`,
      );
    }

    if (!entity.normalized.trim()) {
      throw new Error(
        `Entity at index ${index} has an empty normalized value.`,
      );
    }

    if (
      !ALLOWED_ENTITY_TYPES.has(
        entity.type,
      )
    ) {
      throw new Error(
        `Entity at index ${index} has an invalid type.`,
      );
    }
  }
}

/**
 * Extracts searchable metadata from the complete Turn.
 *
 * The entities returned by the LLM are normalized first and then
 * resolved against the SQLite entity memory.
 */
export async function extractTurnMetadata(
  userMessage: string,
  agentResponse: string,
): Promise<ExtractedTurnMetadata> {
  const prompt = createTurnIndexPrompt(
    userMessage,
    agentResponse,
  );

  const llm = await getAsyncLLM(
    "cheap",
    {
      temperature: 0,
    },
  );

  const response =
    await llm.invoke(prompt);

  const responseText =
    extractMessageText(
      response.content,
    );

  if (!responseText) {
    throw new Error(
      "The LLM returned an empty metadata response.",
    );
  }

  const parsedResponse =
    parseLLMJson(responseText);

  /**
   * First parse and validate the complete model response.
   */
  const metadata =
    parseTurnMetadata(
      parsedResponse,
    );

  /**
   * Compare model entities with the entities stored in SQLite.
   *
   * If a matching stored entity has a similarity score greater
   * than 0.90, its canonical normalized value replaces the new
   * normalized value.
   *
   * Otherwise, the new normalized entity and its embedding
   * are stored in SQLite.
   */
  const resolvedEntities =
    await entityMemoryStore.processEntities(
      metadata.entities,
    );

  return {
    ...metadata,
    entities: uniqueEntities(
      resolvedEntities,
    ),
  };
}

/**
 * Extracts text from a LangChain message response.
 */
function extractMessageText(
  content: unknown,
): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (
        isRecord(block) &&
        typeof block.text === "string"
      ) {
        return block.text;
      }

      return "";
    })
    .filter(
      (text) =>
        text.trim().length > 0,
    )
    .join("\n")
    .trim();
}

/**
 * Parses a JSON response returned by the LLM.
 *
 * Markdown code fences and surrounding text are tolerated.
 */
function parseLLMJson(
  response: string,
): unknown {
  const cleanedResponse = response
    .trim()
    .replace(
      /^```(?:json)?\s*/i,
      "",
    )
    .replace(
      /\s*```$/i,
      "",
    )
    .trim();

  if (!cleanedResponse) {
    throw new Error(
      "The LLM returned an empty JSON response.",
    );
  }

  try {
    return JSON.parse(
      cleanedResponse,
    );
  } catch {
    const jsonText =
      extractFirstJsonObject(
        cleanedResponse,
      );

    if (!jsonText) {
      throw new Error(
        "The LLM did not return a valid JSON object.",
      );
    }

    try {
      return JSON.parse(
        jsonText,
      );
    } catch {
      throw new Error(
        "The LLM returned malformed JSON.",
      );
    }
  }
}

/**
 * Extracts the first balanced JSON object from a string.
 */
function extractFirstJsonObject(
  text: string,
): string | null {
  let startIndex = -1;
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const character = text[index];

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
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (character === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;

      if (
        depth === 0 &&
        startIndex !== -1
      ) {
        return text.slice(
          startIndex,
          index + 1,
        );
      }
    }
  }

  return null;
}

/**
 * Converts an unknown LLM result into Turn metadata.
 */
function parseTurnMetadata(
  value: unknown,
): ExtractedTurnMetadata {
  if (!isRecord(value)) {
    throw new Error(
      "The LLM metadata must be a JSON object.",
    );
  }

  return {
    subject: readRequiredString(
      value.subject,
      "subject",
    ),

    keywords: normalizeKeywords(
      value.keywords,
    ),

    entities: normalizeEntities(
      value.entities,
    ),

    turnType: normalizeTurnType(
      value.turnType,
    ),
  };
}

function normalizeKeywords(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const keywords = value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => item.trim())
    .filter(Boolean);

  return uniqueCaseInsensitive(
    keywords,
  ).slice(0, 10);
}

function normalizeEntities(
  value: unknown,
): TurnEntity[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entities: TurnEntity[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (
      typeof item.text !== "string"
    ) {
      continue;
    }

    const text =
      item.text.trim();

    if (!text) {
      continue;
    }

    const normalized =
      typeof item.normalized ===
        "string" &&
      item.normalized.trim()
        ? normalizeEntityText(
            item.normalized,
          )
        : normalizeEntityText(
            text,
          );

    if (!normalized) {
      continue;
    }

    entities.push({
      text,
      normalized,
      type: normalizeEntityType(
        item.type,
      ),
    });
  }

  return uniqueEntities(
    entities,
  );
}

function normalizeTurnType(
  value: unknown,
): TurnType {
  if (typeof value !== "string") {
    return "other";
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(
      /[\s-]+/g,
      "_",
    );

  if (
    !ALLOWED_TURN_TYPES.has(
      normalized as TurnType,
    )
  ) {
    return "other";
  }

  return normalized as TurnType;
}

function normalizeEntityType(
  value: unknown,
): EntityType {
  if (typeof value !== "string") {
    return "other";
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(
      /[\s-]+/g,
      "_",
    );

  if (
    !ALLOWED_ENTITY_TYPES.has(
      normalized as EntityType,
    )
  ) {
    return "other";
  }

  return normalized as EntityType;
}

/**
 * Creates an embedding using the TextSimilarity service.
 */
async function createEmbedding(
  text: string,
): Promise<number[]> {
  const cleanText =
    text.trim();

  if (!cleanText) {
    throw new Error(
      "Cannot create an embedding for empty text.",
    );
  }

  const embedding =
    await textSimilarity.embedText(
      cleanText,
    );

  assertValidEmbedding(
    embedding,
    "Embedding service result",
  );

  return embedding;
}

/**
 * Creates one embedding for each agent span.
 */
async function createSpanEmbeddings(
  spans: TurnSpan[],
): Promise<SpanEmbedding[]> {
  return Promise.all(
    spans.map(
      async (
        span,
        spanIndex,
      ) => {
        const embedding =
          await createEmbedding(
            createSpanEmbeddingText(
              span,
            ),
          );

        return {
          spanIndex,
          tag: span.tag,
          embedding,
        };
      },
    ),
  );
}

function createSpanEmbeddingText(
  span: TurnSpan,
): string {
  return [
    `Tag: ${span.tag}`,
    `Type: ${span.type}`,
    `Content: ${span.content}`,
  ].join("\n");
}

function createTurnEmbeddingText(
  userMessage: string,
  agentResponse: string,
): string {
  return [
    "User message:",
    userMessage,
    "",
    "Agent response:",
    agentResponse,
  ].join("\n");
}

/**
 * Converts and validates spans returned by createAgentSpans.
 */
function normalizeSpans(
  value: unknown,
): TurnSpan[] {
  if (!Array.isArray(value)) {
    throw new Error(
      "createAgentSpans must return an array.",
    );
  }

  return value.map(
    (item, index) => {
      if (!isRecord(item)) {
        throw new Error(
          `Span at index ${index} must be an object.`,
        );
      }

      const tag =
        readRequiredString(
          item.tag,
          `spans[${index}].tag`,
        );

      const type =
        readRequiredString(
          item.type,
          `spans[${index}].type`,
        );

      const content =
        readRequiredString(
          item.content,
          `spans[${index}].content`,
        );

      const estimatedTokenCount =
        typeof item.estimatedTokenCount ===
          "number" &&
        Number.isFinite(
          item.estimatedTokenCount,
        ) &&
        item.estimatedTokenCount >= 0
          ? Math.ceil(
              item.estimatedTokenCount,
            )
          : estimateTokenCount(
              content,
            );

      const languages =
        normalizeLanguages(
          item.languages,
        );

      return {
        tag,
        type,
        content,
        estimatedTokenCount,

        ...(languages.length > 0
          ? { languages }
          : {}),
      };
    },
  );
}

function normalizeLanguages(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const languages = value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => item.trim())
    .filter(Boolean);

  return uniqueCaseInsensitive(
    languages,
  );
}

/**
 * Returns an approximate token count.
 */
function estimateTokenCount(
  text: string,
): number {
  const normalized =
    text.trim();

  if (!normalized) {
    return 0;
  }

  const latinWords =
    normalized.match(
      /[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g,
    ) ?? [];

  const nonLatinCharacters =
    normalized.match(
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u4E00-\u9FFF]/g,
    ) ?? [];

  const punctuation =
    normalized.match(
      /[()[\]{}<>=+\-*/\\|`~!@#$%^&:;,.?]/g,
    ) ?? [];

  const lineBreaks =
    normalized.match(
      /\n/g,
    ) ?? [];

  const estimate =
    latinWords.length * 1.25 +
    nonLatinCharacters.length * 0.55 +
    punctuation.length * 0.35 +
    lineBreaks.length * 0.2;

  return Math.max(
    1,
    Math.ceil(estimate),
  );
}

function normalizeEntityText(
  text: string,
): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function uniqueCaseInsensitive(
  values: string[],
): string[] {
  const seen =
    new Set<string>();

  const result: string[] = [];

  for (const value of values) {
    const cleanValue =
      value.trim();

    const key = cleanValue
      .normalize("NFKC")
      .toLowerCase();

    if (
      !key ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(cleanValue);
  }

  return result;
}

function uniqueEntities(
  entities: TurnEntity[],
): TurnEntity[] {
  const seen =
    new Set<string>();

  const result: TurnEntity[] = [];

  for (const entity of entities) {
    const normalized =
      normalizeEntityText(
        entity.normalized,
      );

    if (!normalized) {
      continue;
    }

    const key = [
      normalized,
      entity.type,
    ].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    result.push({
      ...entity,
      text: entity.text.trim(),
      normalized,
    });
  }

  return result;
}

function normalizeRequiredInput(
  value: string,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(
      `${fieldName} must be a string.`,
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      `${fieldName} cannot be empty.`,
    );
  }

  return normalized;
}

function readRequiredString(
  value: unknown,
  fieldName: string,
): string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(
      `The LLM response has an invalid "${fieldName}" field.`,
    );
  }

  return value.trim();
}

function assertValidEmbedding(
  value: unknown,
  fieldName: string,
): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(
      (item) =>
        typeof item !== "number" ||
        !Number.isFinite(item),
    )
  ) {
    throw new Error(
      `${fieldName} must be a non-empty array of finite numbers.`,
    );
  }
}

/**
 * Validates the exact ISO format created by Date.toISOString().
 */
function isValidIsoDateString(
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return false;
  }

  const isoDatePattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  if (
    !isoDatePattern.test(value)
  ) {
    return false;
  }

  const timestamp =
    Date.parse(value);

  if (
    !Number.isFinite(timestamp)
  ) {
    return false;
  }

  try {
    return (
      new Date(
        timestamp,
      ).toISOString() === value
    );
  } catch {
    return false;
  }
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}