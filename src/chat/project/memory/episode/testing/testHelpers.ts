// episode/testing/testHelpers.ts

/**
 * Shared helpers for the Episode unit tests.
 *
 * All LLM, embedding, and database calls are mocked. The tests never
 * depend on real external APIs.
 */

import type {
  MemoryWindow,
  Turn,
  TurnIndexes,
  WindowEntity,
} from "../../window/types";

/**
 * Embedding vector used for all "database" related texts.
 */
export const DATABASE_VECTOR = [1, 0.05];

/**
 * Embedding vector used for all "cooking" related texts.
 */
export const COOKING_VECTOR = [0.05, 1];

const TOPIC_VECTORS: Array<{
  token: string;
  vector: number[];
}> = [
  { token: "database", vector: DATABASE_VECTOR },
  { token: "sql", vector: DATABASE_VECTOR },
  { token: "postgres", vector: DATABASE_VECTOR },
  { token: "cooking", vector: COOKING_VECTOR },
  { token: "recipe", vector: COOKING_VECTOR },
];

/**
 * Deterministically maps an embedding text to a topic vector so
 * related texts produce a similarity of 1 and unrelated texts produce
 * a similarity near 0.
 */
export function vectorForText(
  text: string,
): number[] {
  const lowerText = text.toLowerCase();

  for (const topic of TOPIC_VECTORS) {
    if (lowerText.includes(topic.token)) {
      return [...topic.vector];
    }
  }

  return [0.5, 0.5];
}

/**
 * Cosine similarity used by the mocked embedding comparison.
 */
export function cosineSimilarity(
  vectorA: number[],
  vectorB: number[],
): number {
  if (
    vectorA.length === 0 ||
    vectorA.length !== vectorB.length
  ) {
    return 0;
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < vectorA.length; index += 1) {
    const valueA = vectorA[index] ?? 0;
    const valueB = vectorB[index] ?? 0;

    dotProduct += valueA * valueB;
    magnitudeA += valueA * valueA;
    magnitudeB += valueB * valueB;
  }

  const denominator =
    Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);

  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

export interface TestTurnOptions {
  subject: string;
  keywords?: string[];
  entities?: WindowEntity[];
  type?: string;
  vector?: number[];
}

export function createTestTurn(
  options: TestTurnOptions,
): Turn {
  const indexes: TurnIndexes = {
    subject: options.subject,
    keywords: options.keywords ?? [],
    entities: options.entities,
    type: options.type ?? "question",
    embedding: options.vector ?? [
      ...DATABASE_VECTOR,
    ],
  };

  return {
    userMessage: `User message about ${options.subject}`,
    agentResponse: `Agent response about ${options.subject}`,
    indexes,
    createdAt: "2024-01-01T00:00:00.000Z",
    estimatedTokens: 10,
  };
}

export interface TestWindowOptions {
  id: string;
  subjects: string[];
  keywords?: string[];
  types?: string[];

  /**
   * Entities stored on the single Turn of the Window.
   */
  entities?: WindowEntity[];

  vector: number[];
  sessionId?: string;
  episodeId?: string;
  status?: "open" | "closed";
  estimatedTokens?: number;
  turns?: Turn[];
  startedAt?: string;
  updatedAt?: string;
}

export function createTestWindow(
  options: TestWindowOptions,
): MemoryWindow {
  const turns =
    options.turns ??
    (options.entities
      ? [
          createTestTurn({
            subject: options.subjects[0] ?? "",
            entities: options.entities,
          }),
        ]
      : []);

  return {
    id: options.id,
    turns,
    indexes: {
      subjects: options.subjects,
      keywords: options.keywords ?? [],
      types: options.types ?? [],
      embedding: [...options.vector],
    },
    status: options.status ?? "closed",
    estimatedTokens: options.estimatedTokens ?? 100,
    startedAt:
      options.startedAt ?? "2024-01-01T00:00:00.000Z",
    updatedAt:
      options.updatedAt ?? "2024-01-01T00:00:00.000Z",
    ...(options.sessionId !== undefined
      ? { sessionId: options.sessionId }
      : {}),
    ...(options.episodeId !== undefined
      ? { episodeId: options.episodeId }
      : {}),
  };
}
