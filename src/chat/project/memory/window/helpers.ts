// window/helpers.ts

import type { MemoryWindow } from "./types";

/* -------------------------------------------------------------------------- */
/* General Helpers                                                            */
/* -------------------------------------------------------------------------- */

export function normalizeText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

export function uniqueStrings(values: string[]): string[] {
  const uniqueValues = new Map<string, string>();

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmedValue = value.trim();

    if (!trimmedValue) {
      continue;
    }

    const normalizedValue = normalizeText(trimmedValue);

    if (!uniqueValues.has(normalizedValue)) {
      uniqueValues.set(normalizedValue, trimmedValue);
    }
  }

  return Array.from(uniqueValues.values());
}

export function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    Math.max(value, minimum),
    maximum,
  );
}

export function isFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * Generates a unique and stable Window ID.
 */
export function createWindowId(): string {
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

export function cloneWindow(window: MemoryWindow): MemoryWindow {
  return {
    ...window,
    turns: window.turns.map((turn) => ({
      ...turn,
      indexes: {
        ...turn.indexes,
        keywords: [...turn.indexes.keywords],
        embedding: [...turn.indexes.embedding],
      },
    })),
    indexes: {
      subjects: [...window.indexes.subjects],
      keywords: [...window.indexes.keywords],
      types: [...window.indexes.types],
      embedding: [...window.indexes.embedding],
    },
  };
}
