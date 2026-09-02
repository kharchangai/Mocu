// episode/validation.ts

import type { MemoryWindow } from "../window/types";
import { isFiniteNumber } from "../window/helpers";
import type {
  EpisodeManagerConfig,
  MemoryEpisode,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function isEpisodeStatus(
  value: unknown,
): value is "open" | "closed" {
  return value === "open" || value === "closed";
}

function assertValidStringArray(
  value: unknown,
  label: string,
): void {
  if (!Array.isArray(value)) {
    throw new Error(
      `${label} must be an array.`,
    );
  }

  if (
    value.some(
      (item) => typeof item !== "string",
    )
  ) {
    throw new Error(
      `Every item in ${label} must be a string.`,
    );
  }
}

export function assertValidConfig(
  config: EpisodeManagerConfig,
): void {
  if (
    !isFiniteNumber(config.similarityThreshold) ||
    config.similarityThreshold < 0 ||
    config.similarityThreshold > 1
  ) {
    throw new Error(
      "similarityThreshold must be between 0 and 1.",
    );
  }

  const totalWeight =
    config.embeddingWeight +
    config.keywordWeight +
    config.entityWeight;

  if (
    !isFiniteNumber(config.embeddingWeight) ||
    !isFiniteNumber(config.keywordWeight) ||
    !isFiniteNumber(config.entityWeight) ||
    config.embeddingWeight < 0 ||
    config.keywordWeight < 0 ||
    config.entityWeight < 0 ||
    totalWeight <= 0
  ) {
    throw new Error(
      "The Episode scoring weights must be non-negative finite numbers with a sum greater than 0.",
    );
  }
}

/**
 * Validates a Window before it is processed by the EpisodeManager.
 */
export function assertValidWindowForEpisode(
  window: MemoryWindow,
): void {
  if (
    !window ||
    typeof window !== "object"
  ) {
    throw new Error(
      "A valid Window is required.",
    );
  }

  if (
    typeof window.id !== "string" ||
    !window.id.trim()
  ) {
    throw new Error(
      "The Window must contain a non-empty id.",
    );
  }

  if (!isEpisodeStatus(window.status)) {
    throw new Error(
      'The Window status must be "open" or "closed".',
    );
  }

  if (!Array.isArray(window.turns)) {
    throw new Error(
      "The Window must contain a Turns array.",
    );
  }

  if (
    !window.indexes ||
    typeof window.indexes !== "object"
  ) {
    throw new Error(
      "The Window must contain indexes.",
    );
  }

  assertValidStringArray(
    window.indexes.subjects,
    "The Window subjects",
  );

  assertValidStringArray(
    window.indexes.keywords,
    "The Window keywords",
  );

  assertValidStringArray(
    window.indexes.types,
    "The Window types",
  );

  if (
    !Array.isArray(window.indexes.embedding) ||
    window.indexes.embedding.some(
      (value) => !isFiniteNumber(value),
    )
  ) {
    throw new Error(
      "The Window embedding must be an array of finite numbers.",
    );
  }

  if (
    !isFiniteNumber(window.estimatedTokens) ||
    window.estimatedTokens < 0
  ) {
    throw new Error(
      "The Window must contain valid estimatedTokens.",
    );
  }
}

function assertValidStoredEntity(
  value: unknown,
): void {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "A stored Episode entity must be an object.",
    );
  }

  const candidate =
    value as Record<string, unknown>;

  if (
    typeof candidate.text !== "string" ||
    typeof candidate.normalized !== "string" ||
    typeof candidate.type !== "string"
  ) {
    throw new Error(
      "A stored Episode entity must contain text, normalized, and type strings.",
    );
  }
}

function assertValidStoredIndexes(
  indexes: unknown,
): void {
  if (
    !indexes ||
    typeof indexes !== "object" ||
    Array.isArray(indexes)
  ) {
    throw new Error(
      "A stored Episode must contain indexes.",
    );
  }

  const candidate =
    indexes as Record<string, unknown>;

  if (
    typeof candidate.subject !== "string" ||
    !candidate.subject.trim()
  ) {
    throw new Error(
      "Stored Episode indexes must contain a non-empty subject.",
    );
  }

  assertValidStringArray(
    candidate.subjects,
    "Stored Episode subjects",
  );

  assertValidStringArray(
    candidate.keywords,
    "Stored Episode keywords",
  );

  assertValidStringArray(
    candidate.types,
    "Stored Episode types",
  );

  if (!Array.isArray(candidate.entities)) {
    throw new Error(
      "Stored Episode indexes must contain an entities array.",
    );
  }

  for (const entity of candidate.entities) {
    assertValidStoredEntity(entity);
  }

  if (
    !Array.isArray(candidate.embedding) ||
    candidate.embedding.some(
      (item) => !isFiniteNumber(item),
    )
  ) {
    throw new Error(
      "Stored Episode indexes must contain a valid embedding array.",
    );
  }
}

/**
 * Validates an Episode that was read from the database.
 */
export function assertValidStoredEpisode(
  value: unknown,
): asserts value is MemoryEpisode {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "A stored Episode must be an object.",
    );
  }

  const candidate =
    value as Record<string, unknown>;

  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim()
  ) {
    throw new Error(
      "A stored Episode must contain a non-empty id.",
    );
  }

  if (
    typeof candidate.sessionId !== "string" ||
    !candidate.sessionId.trim()
  ) {
    throw new Error(
      "A stored Episode must contain a non-empty sessionId.",
    );
  }

  if (!Array.isArray(candidate.windowIds)) {
    throw new Error(
      "A stored Episode must contain a windowIds array.",
    );
  }

  assertValidStringArray(
    candidate.windowIds,
    "Stored Episode windowIds",
  );

  const uniqueWindowIds = new Set<string>();

  for (const windowId of candidate.windowIds) {
    if (uniqueWindowIds.has(windowId)) {
      throw new Error(
        "A stored Episode must not contain duplicate Window ids.",
      );
    }

    uniqueWindowIds.add(windowId);
  }

  assertValidStoredIndexes(
    candidate.indexes,
  );

  if (!isEpisodeStatus(candidate.status)) {
    throw new Error(
      'A stored Episode status must be "open" or "closed".',
    );
  }

  if (
    !isFiniteNumber(candidate.estimatedTokens) ||
    candidate.estimatedTokens < 0
  ) {
    throw new Error(
      "A stored Episode must contain valid estimatedTokens.",
    );
  }

  if (
    typeof candidate.startedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.startedAt))
  ) {
    throw new Error(
      "A stored Episode must contain a valid startedAt.",
    );
  }

  if (
    typeof candidate.updatedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.updatedAt))
  ) {
    throw new Error(
      "A stored Episode must contain a valid updatedAt.",
    );
  }

  if (
    candidate.closedAt !== undefined &&
    (typeof candidate.closedAt !== "string" ||
      Number.isNaN(Date.parse(candidate.closedAt)))
  ) {
    throw new Error(
      "A stored Episode must contain a valid closedAt.",
    );
  }
}
