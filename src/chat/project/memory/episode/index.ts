// episode/index.ts

/**
 * Public API of the Episode layer.
 */

import { EpisodeManager } from "./EpisodeManager";
import type {
  AssignWindowToEpisodeResult,
  EpisodeAction,
  EpisodeCandidateScore,
  EpisodeManagerConfig,
  EpisodeStatus,
  EpisodeWindowSummary,
  MemoryEpisode,
} from "./types";
import type { MemoryWindow } from "../window/types";

export type {
  AssignWindowToEpisodeResult,
  EpisodeAction,
  EpisodeCandidateScore,
  EpisodeManagerConfig,
  EpisodeStatus,
  EpisodeWindowSummary,
  MemoryEpisode,
};

export { EPISODE_RECORD_TYPE } from "./episodeStorage";
export { DEFAULT_SESSION_ID } from "./types";
export { EpisodeManager } from "./EpisodeManager";
export { buildEpisodeIndexes } from "./episodeIndexes";

/* -------------------------------------------------------------------------- */
/* Default Instance and Simple API                                            */
/* -------------------------------------------------------------------------- */

export const episodeManager =
  new EpisodeManager();

/**
 * Main function called after a Window has been processed.
 *
 * It finds or creates a suitable Episode for the Window, rebuilds the
 * Episode indexes, persists both sides of the relationship, and returns
 * the id of the affected Episode.
 */
export async function assignWindowToEpisode(
  window: MemoryWindow,
): Promise<AssignWindowToEpisodeResult> {
  return episodeManager.addWindow(window);
}

/**
 * Explicitly moves a Window to another Episode of the same session.
 *
 * This operation is never performed inside the normal assignment
 * logic.
 */
export async function reassignWindowToEpisode(
  window: MemoryWindow,
  targetEpisodeId: string,
): Promise<AssignWindowToEpisodeResult> {
  return episodeManager.reassignWindow(
    window,
    targetEpisodeId,
  );
}

export async function getAllEpisodes(): Promise<
  MemoryEpisode[]
> {
  return episodeManager.getAllEpisodes();
}

export async function getOpenEpisodes(): Promise<
  MemoryEpisode[]
> {
  return episodeManager.getOpenEpisodes();
}

export async function getEpisodesForSession(
  sessionId: string,
): Promise<MemoryEpisode[]> {
  return episodeManager.getEpisodesForSession(
    sessionId,
  );
}

export async function getEpisodeById(
  episodeId: string,
): Promise<MemoryEpisode | null> {
  return episodeManager
    .getAllEpisodes()
    .then((episodes) =>
      episodes.find(
        (episode) => episode.id === episodeId,
      ) ?? null,
    );
}

export async function closeEpisodeById(
  episodeId: string,
): Promise<MemoryEpisode | null> {
  return episodeManager.closeEpisodeById(
    episodeId,
  );
}

export async function clearEpisodes(): Promise<void> {
  await episodeManager.clearEpisodes();
}
