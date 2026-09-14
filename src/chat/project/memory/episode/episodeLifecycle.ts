// episode/episodeLifecycle.ts

import type { MemoryWindow } from "../window/types";
import { loadAllWindows } from "../window/windowStorage";
import type { MemoryEpisode } from "./types";
import {
  appendWindowIdUnique,
  cloneEpisode,
  createEpisodeId,
  hasWindowId,
} from "./helpers";
import { buildEpisodeIndexes } from "./episodeIndexes";

/* -------------------------------------------------------------------------- */
/* Episode Lifecycle                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Creates a new open Episode with the Window as its first member.
 */
export async function createEpisode(
  window: MemoryWindow,
  sessionId: string,
): Promise<MemoryEpisode> {
  const now = new Date().toISOString();

  return {
    id: createEpisodeId(),
    sessionId,
    windowIds: [window.id],
    indexes: await buildEpisodeIndexes([
      window,
    ]),
    status: "open",
    estimatedTokens: window.estimatedTokens,
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Loads the member Windows of an Episode in windowIds order.
 *
 * The authoritative Window replaces its stored copy because it may
 * contain changes that were not persisted yet. Stored Windows that no
 * longer exist are skipped.
 */
export async function loadEpisodeMemberWindows(
  episode: MemoryEpisode,
  authoritativeWindow: MemoryWindow,
): Promise<MemoryWindow[]> {
  const storedWindows =
    await loadAllWindows();

  const windowsById = new Map<
    string,
    MemoryWindow
  >();

  for (const storedWindow of storedWindows) {
    windowsById.set(
      storedWindow.id,
      storedWindow,
    );
  }

  windowsById.set(
    authoritativeWindow.id,
    authoritativeWindow,
  );

  const memberWindows: MemoryWindow[] = [];

  for (const windowId of episode.windowIds) {
    const memberWindow =
      windowsById.get(windowId);

    if (memberWindow) {
      memberWindows.push(memberWindow);
    }
  }

  return memberWindows;
}

/**
 * Rebuilds an Episode after a member Window was added or changed.
 *
 * The Window id is added without duplication, all indexes are rebuilt
 * from the member Windows, and the token estimate is recalculated from
 * the member Windows.
 */
export async function rebuildEpisode(
  episode: MemoryEpisode,
  authoritativeWindow: MemoryWindow,
): Promise<MemoryEpisode> {
  const windowIds = appendWindowIdUnique(
    episode.windowIds,
    authoritativeWindow.id,
  );

  const memberWindows =
    await loadEpisodeMemberWindows(
      { ...episode, windowIds },
      authoritativeWindow,
    );

  return {
    ...episode,
    windowIds,
    indexes: await buildEpisodeIndexes(
      memberWindows,
    ),
    estimatedTokens: memberWindows.reduce(
      (total, memberWindow) =>
        total + memberWindow.estimatedTokens,
      0,
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Removes a Window from an Episode and rebuilds the indexes from the
 * remaining member Windows.
 *
 * Returns null when the Episode would become empty, which means the
 * caller should delete it.
 */
export async function removeWindowFromEpisode(
  episode: MemoryEpisode,
  windowId: string,
): Promise<MemoryEpisode | null> {
  if (!hasWindowId(episode.windowIds, windowId)) {
    return cloneEpisode(episode);
  }

  const remainingWindowIds =
    episode.windowIds.filter(
      (memberWindowId) =>
        memberWindowId !== windowId,
    );

  if (remainingWindowIds.length === 0) {
    return null;
  }

  const storedWindows =
    await loadAllWindows();

  const remainingWindowIdsSet = new Set(
    remainingWindowIds,
  );

  const memberWindows = storedWindows.filter(
    (storedWindow) =>
      remainingWindowIdsSet.has(
        storedWindow.id,
      ),
  );

  if (memberWindows.length === 0) {
    return null;
  }

  return {
    ...episode,
    windowIds: remainingWindowIds,
    indexes: await buildEpisodeIndexes(
      memberWindows,
    ),
    estimatedTokens: memberWindows.reduce(
      (total, memberWindow) =>
        total + memberWindow.estimatedTokens,
      0,
    ),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Closes an open Episode.
 *
 * Closed Episodes are not selected for new Window assignments.
 */
export function closeEpisode(
  episode: MemoryEpisode,
  closedAt = new Date().toISOString(),
): MemoryEpisode {
  if (episode.status === "closed") {
    return episode;
  }

  return {
    ...episode,
    status: "closed",
    updatedAt: closedAt,
    closedAt,
  };
}
