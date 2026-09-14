// episode/episodeStorage.ts

import { databaseManager } from "../storage/databaseManager";
import type { MemoryEpisode } from "./types";
import { cloneEpisode } from "./helpers";
import { assertValidStoredEpisode } from "./validation";

/* -------------------------------------------------------------------------- */
/* Database Persistence                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record type used for Episodes inside the SQLite database.
 */
export const EPISODE_RECORD_TYPE =
  "episode";

/**
 * Inserts or updates an Episode in the database.
 *
 * The Episode id is used as the record key, so the created_at timestamp
 * of the first insert is preserved across updates. The session id is
 * also stored in the session_key column of the record.
 */
export async function saveEpisode(
  episode: MemoryEpisode,
): Promise<void> {
  await databaseManager.upsert<MemoryEpisode>({
    type: EPISODE_RECORD_TYPE,
    key: episode.id,
    sessionKey: episode.sessionId,
    data: episode,
  });
}

/**
 * Loads and validates every persisted Episode, oldest first.
 */
export async function loadAllEpisodes(): Promise<
  MemoryEpisode[]
> {
  const storedRecords =
    await databaseManager.getByType<MemoryEpisode>(
      EPISODE_RECORD_TYPE,
    );

  return storedRecords.map((record) => {
    assertValidStoredEpisode(record.data);

    return cloneEpisode(record.data);
  });
}

/**
 * Loads one persisted Episode by its id.
 */
export async function loadEpisodeById(
  episodeId: string,
): Promise<MemoryEpisode | null> {
  const storedRecord =
    await databaseManager.get<MemoryEpisode>(
      episodeId,
    );

  if (!storedRecord) {
    return null;
  }

  assertValidStoredEpisode(storedRecord.data);

  return cloneEpisode(storedRecord.data);
}

/**
 * Removes one persisted Episode by its id.
 */
export async function deleteEpisodeById(
  episodeId: string,
): Promise<boolean> {
  return databaseManager.delete(episodeId);
}

/**
 * Removes all persisted Episodes from the database.
 */
export async function deleteAllEpisodes(): Promise<number> {
  return databaseManager.deleteByType(
    EPISODE_RECORD_TYPE,
  );
}
