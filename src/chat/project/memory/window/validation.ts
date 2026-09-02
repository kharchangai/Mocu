// window/validation.ts

import type {
  MemoryWindow,
  Turn,
  WindowManagerConfig,
} from "./types";
import { isFiniteNumber } from "./helpers";

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export function assertValidConfig(
  config: WindowManagerConfig,
): void {
  if (
    !Number.isInteger(config.maximumTurns) ||
    config.maximumTurns < 1
  ) {
    throw new Error(
      "maximumTurns must be an integer greater than or equal to 1.",
    );
  }

  if (
    !isFiniteNumber(config.maximumTokens) ||
    config.maximumTokens < 1
  ) {
    throw new Error(
      "maximumTokens must be a finite number greater than or equal to 1.",
    );
  }

  if (
    !Number.isInteger(
      config.recentTurnsForBoundary,
    ) ||
    config.recentTurnsForBoundary < 1
  ) {
    throw new Error(
      "recentTurnsForBoundary must be an integer greater than or equal to 1.",
    );
  }

  if (
    !isFiniteNumber(
      config.fallbackSimilarityThreshold,
    ) ||
    config.fallbackSimilarityThreshold < 0 ||
    config.fallbackSimilarityThreshold > 1
  ) {
    throw new Error(
      "fallbackSimilarityThreshold must be between 0 and 1.",
    );
  }
}

export function assertValidTurn(turn: Turn): void {
  if (!turn || typeof turn !== "object") {
    throw new Error(
      "A valid Turn is required.",
    );
  }

  if (typeof turn.userMessage !== "string") {
    throw new Error(
      "Turn userMessage must be a string.",
    );
  }

  if (
    typeof turn.agentResponse !== "string"
  ) {
    throw new Error(
      "Turn agentResponse must be a string.",
    );
  }

  if (
    typeof turn.createdAt !== "string" ||
    !turn.createdAt.trim()
  ) {
    throw new Error(
      "Turn createdAt must be a non-empty date string.",
    );
  }

  if (Number.isNaN(Date.parse(turn.createdAt))) {
    throw new Error(
      "Turn createdAt must contain a valid date string.",
    );
  }

  if (
    !turn.indexes ||
    typeof turn.indexes !== "object"
  ) {
    throw new Error(
      "The Turn must contain indexes.",
    );
  }

  if (
    typeof turn.indexes.subject !== "string" ||
    !turn.indexes.subject.trim()
  ) {
    throw new Error(
      "Turn indexes must contain a non-empty subject.",
    );
  }

  if (!Array.isArray(turn.indexes.keywords)) {
    throw new Error(
      "Turn indexes must contain a keywords array.",
    );
  }

  if (
    turn.indexes.keywords.some(
      (keyword) => typeof keyword !== "string",
    )
  ) {
    throw new Error(
      "Every Turn keyword must be a string.",
    );
  }

  if (
    typeof turn.indexes.type !== "string" ||
    !turn.indexes.type.trim()
  ) {
    throw new Error(
      "Turn indexes must contain a non-empty type.",
    );
  }

  if (
    !Array.isArray(turn.indexes.embedding) ||
    turn.indexes.embedding.length === 0
  ) {
    throw new Error(
      "Turn indexes must contain a non-empty embedding array.",
    );
  }

  if (
    turn.indexes.embedding.some(
      (value) => !isFiniteNumber(value),
    )
  ) {
    throw new Error(
      "Every embedding element must be a finite number.",
    );
  }

  if (
    !isFiniteNumber(turn.estimatedTokens) ||
    turn.estimatedTokens < 0
  ) {
    throw new Error(
      "Turn estimatedTokens must be a non-negative finite number.",
    );
  }
}

export function assertValidStoredWindow(
  value: unknown,
): asserts value is MemoryWindow {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "A stored Window must be an object.",
    );
  }

  const candidate =
    value as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim()
  ) {
    throw new Error(
      "A stored Window must contain a non-empty id.",
    );
  }

  if (!Array.isArray(candidate.turns)) {
    throw new Error(
      "A stored Window must contain a Turns array.",
    );
  }

  for (const turn of candidate.turns) {
    assertValidTurn(turn as Turn);
  }

  if (
    candidate.status !== "open" &&
    candidate.status !== "closed"
  ) {
    throw new Error(
      'A stored Window status must be "open" or "closed".',
    );
  }

  if (
    !isFiniteNumber(candidate.estimatedTokens) ||
    candidate.estimatedTokens < 0
  ) {
    throw new Error(
      "A stored Window must contain valid estimatedTokens.",
    );
  }

  if (
    typeof candidate.startedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.startedAt))
  ) {
    throw new Error(
      "A stored Window must contain a valid startedAt.",
    );
  }

  if (
    typeof candidate.updatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    throw new Error(
      "A stored Window must contain a valid updatedAt.",
    );
  }

  if (
    !candidate.indexes ||
    typeof candidate.indexes !== "object" ||
    Array.isArray(candidate.indexes)
  ) {
    throw new Error(
      "A stored Window must contain indexes.",
    );
  }

  const indexes =
    candidate.indexes as Record<string, unknown>;

  if (
    !Array.isArray(indexes.subjects) ||
    !Array.isArray(indexes.keywords) ||
    !Array.isArray(indexes.types) ||
    !Array.isArray(indexes.embedding)
  ) {
    throw new Error(
      "Stored Window indexes are invalid.",
    );
  }

  if (
    indexes.subjects.some(
      (item) => typeof item !== "string",
    ) ||
    indexes.keywords.some(
      (item) => typeof item !== "string",
    ) ||
    indexes.types.some(
      (item) => typeof item !== "string",
    ) ||
    indexes.embedding.some(
      (item) => !isFiniteNumber(item),
    )
  ) {
    throw new Error(
      "Stored Window index values are invalid.",
    );
  }
}
