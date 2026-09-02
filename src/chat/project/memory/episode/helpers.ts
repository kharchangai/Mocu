// episode/helpers.ts

import type { MemoryWindow } from "../window/types";
import type { MemoryEpisode } from "./types";
import { DEFAULT_SESSION_ID } from "./types";

/* -------------------------------------------------------------------------- */
/* General Helpers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the session of a Window.
 *
 * The existing Window pipeline has no session field, therefore such
 * Windows belong to the default session.
 */
export function resolveSessionId(
  window: MemoryWindow,
): string {
  const sessionId = window.sessionId?.trim();

  return sessionId
    ? sessionId
    : DEFAULT_SESSION_ID;
}

/**
 * Generates a unique and stable Episode ID.
 */
export function createEpisodeId(): string {
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

export function cloneEpisode(
  episode: MemoryEpisode,
): MemoryEpisode {
  return {
    ...episode,
    windowIds: [...episode.windowIds],
    indexes: {
      subject: episode.indexes.subject,
      subjects: [...episode.indexes.subjects],
      keywords: [...episode.indexes.keywords],
      types: [...episode.indexes.types],
      entities: episode.indexes.entities.map(
        (entity) => ({ ...entity }),
      ),
      embedding: [...episode.indexes.embedding],
    },
  };
}

/**
 * Returns the Window ids with the new id appended.
 *
 * The Window id can appear at most once and empty ids are ignored.
 * The original order is preserved.
 */
export function appendWindowIdUnique(
  windowIds: string[],
  windowId: string,
): string[] {
  const uniqueWindowIds: string[] = [];
  const seen = new Set<string>();

  for (const existingId of windowIds) {
    if (
      typeof existingId !== "string" ||
      !existingId.trim() ||
      seen.has(existingId)
    ) {
      continue;
    }

    seen.add(existingId);
    uniqueWindowIds.push(existingId);
  }

  if (windowId.trim() && !seen.has(windowId)) {
    uniqueWindowIds.push(windowId);
  }

  return uniqueWindowIds;
}

export function hasWindowId(
  windowIds: string[],
  windowId: string,
): boolean {
  return windowIds.includes(windowId);
}
