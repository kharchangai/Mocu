// episode/EpisodeManager.ts

import type {
  AssignWindowToEpisodeResult,
  EpisodeManagerConfig,
  MemoryEpisode,
} from "./types";
import type { MemoryWindow } from "../window/types";
import {
  cloneEpisode,
  resolveSessionId,
} from "./helpers";
import {
  assertValidConfig,
  assertValidWindowForEpisode,
} from "./validation";
import {
  deleteAllEpisodes,
  deleteEpisodeById,
  loadAllEpisodes,
  loadEpisodeById,
  saveEpisode,
} from "./episodeStorage";
import {
  closeEpisode,
  createEpisode,
  rebuildEpisode,
  removeWindowFromEpisode,
} from "./episodeLifecycle";
import { saveWindow } from "../window/windowStorage";
import { findBestEpisodeCandidate } from "./episodeMatching";
import { getErrorMessage } from "../window/helpers";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_CONFIG: EpisodeManagerConfig = {
  /**
   * Starting point that requires empirical calibration.
   *
   * It is intentionally below the Window fallback similarity threshold
   * (0.42) because an Episode groups several Windows and must match
   * semantically broader than a Window.
   */
  similarityThreshold: 0.38,
  embeddingWeight: 0.6,
  keywordWeight: 0.25,
  entityWeight: 0.15,
};

/* -------------------------------------------------------------------------- */
/* EpisodeManager                                                             */
/* -------------------------------------------------------------------------- */

export class EpisodeManager {
  private readonly config: EpisodeManagerConfig;

  /**
   * Prevents concurrent operations from changing the same Episode.
   */
  private operationQueue: Promise<void> =
    Promise.resolve();

  public constructor(
    config: Partial<EpisodeManagerConfig> = {},
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    assertValidConfig(this.config);
  }

  /**
   * Assigns a Window to an Episode.
   *
   * This is the Episode equivalent of WindowManager.addTurn:
   *
   * 1. If the Window already has an episodeId, that Episode is loaded,
   *    the Window id is kept unique inside it, the indexes are rebuilt,
   *    and the Episode is saved ("updated").
   * 2. Otherwise, open Episodes of the same session are scored and the
   *    Window is appended to the best match ("appended").
   * 3. If no Episode reaches the threshold, a new Episode is created
   *    ("created").
   *
   * Both sides of the relationship are persisted: episode.windowIds
   * contains the Window id and window.episodeId points to the Episode.
   */
  public async addWindow(
    window: MemoryWindow,
  ): Promise<AssignWindowToEpisodeResult> {
    assertValidWindowForEpisode(window);

    return this.runExclusive(async () => {
      const sessionId =
        resolveSessionId(window);

      const existingEpisodeId =
        window.episodeId?.trim();

      if (existingEpisodeId) {
        const existingEpisode =
          await loadEpisodeById(
            existingEpisodeId,
          );

        if (existingEpisode) {
          return this.updateExistingEpisode(
            existingEpisode,
            window,
          );
        }

        /*
         * The stored Episode reference is stale. The Window is assigned
         * like an unassigned Window and the corrected episodeId is
         * persisted below.
         */
      }

      const candidates = (
        await loadAllEpisodes()
      ).filter(
        (episode) =>
          episode.sessionId === sessionId &&
          episode.status === "open",
      );

      const bestCandidate =
        findBestEpisodeCandidate(
          window,
          candidates,
          this.config,
        );

      if (bestCandidate) {
        return this.appendWindowToEpisode(
          bestCandidate.episode,
          window,
        );
      }

      return this.createNewEpisode(
        window,
        sessionId,
      );
    });
  }

  /**
   * Returns copies of all persisted Episodes.
   */
  public async getAllEpisodes(): Promise<
    MemoryEpisode[]
  > {
    return loadAllEpisodes();
  }

  /**
   * Returns all open Episodes.
   */
  public async getOpenEpisodes(): Promise<
    MemoryEpisode[]
  > {
    return (
      await loadAllEpisodes()
    ).filter(
      (episode) =>
        episode.status === "open",
    );
  }

  /**
   * Returns all Episodes of one session.
   */
  public async getEpisodesForSession(
    sessionId: string,
  ): Promise<MemoryEpisode[]> {
    const normalizedSessionId =
      sessionId.trim();

    if (!normalizedSessionId) {
      throw new Error(
        "The session id cannot be empty.",
      );
    }

    return (
      await loadAllEpisodes()
    ).filter(
      (episode) =>
        episode.sessionId ===
        normalizedSessionId,
    );
  }

  /**
   * Closes one Episode by id.
   *
   * Closed Episodes are not selected for new Window assignments.
   */
  public async closeEpisodeById(
    episodeId: string,
  ): Promise<MemoryEpisode | null> {
    return this.runExclusive(async () => {
      const episode =
        await loadEpisodeById(episodeId);

      if (!episode) {
        return null;
      }

      const closedEpisode = closeEpisode(
        episode,
      );

      await saveEpisode(closedEpisode);

      return cloneEpisode(closedEpisode);
    });
  }

  /**
   * Moves a Window to another Episode of the same session.
   *
   * This is an explicit operation and is never performed inside the
   * normal assignment logic.
   */
  public async reassignWindow(
    window: MemoryWindow,
    targetEpisodeId: string,
  ): Promise<AssignWindowToEpisodeResult> {
    assertValidWindowForEpisode(window);

    const normalizedTargetEpisodeId =
      targetEpisodeId.trim();

    if (!normalizedTargetEpisodeId) {
      throw new Error(
        "The target Episode id cannot be empty.",
      );
    }

    return this.runExclusive(async () => {
      const sessionId =
        resolveSessionId(window);

      const targetEpisode =
        await loadEpisodeById(
          normalizedTargetEpisodeId,
        );

      if (!targetEpisode) {
        throw new Error(
          `The target Episode does not exist: ${normalizedTargetEpisodeId}`,
        );
      }

      if (targetEpisode.sessionId !== sessionId) {
        throw new Error(
          "A Window cannot be reassigned to an Episode of another session.",
        );
      }

      if (window.episodeId === targetEpisode.id) {
        return this.updateExistingEpisode(
          targetEpisode,
          window,
        );
      }

      const previousEpisode =
        window.episodeId
          ? await loadEpisodeById(
              window.episodeId,
            )
          : null;

      if (
        window.episodeId &&
        !previousEpisode
      ) {
        throw new Error(
          `The current Episode of the Window does not exist: ${window.episodeId}`,
        );
      }

      /*
       * 1. Add the Window to the target Episode.
       */
      const rebuiltTarget =
        await rebuildEpisode(
          targetEpisode,
          window,
        );

      await saveEpisode(rebuiltTarget);

      try {
        /*
         * 2. Point the Window to the target Episode.
         */
        await saveWindow({
          ...window,
          episodeId: targetEpisode.id,
        });
      } catch (error) {
        await this.restoreEpisode(
          targetEpisode,
          error,
        );

        throw error;
      }

      /*
       * 3. Remove the Window from the previous Episode.
       *    An Episode that would become empty is deleted.
       */
      if (previousEpisode) {
        const previousCopy =
          cloneEpisode(previousEpisode);

        const updatedPrevious =
          await removeWindowFromEpisode(
            previousEpisode,
            window.id,
          );

        if (!updatedPrevious) {
          await deleteEpisodeById(
            previousEpisode.id,
          );
        } else {
          try {
            await saveEpisode(updatedPrevious);
          } catch (error) {
            await this.restoreEpisode(
              previousCopy,
              error,
            );

            throw error;
          }
        }
      }

      return {
        episodeId: rebuiltTarget.id,
        action: "appended",
        episode: cloneEpisode(rebuiltTarget),
      };
    });
  }

  /**
   * Removes all persisted Episodes from the database.
   */
  public async clearEpisodes(): Promise<void> {
    await deleteAllEpisodes();
  }

  /* ------------------------------------------------------------------------ */
  /* Internal Operations                                                      */
  /* ------------------------------------------------------------------------ */

  private async updateExistingEpisode(
    episode: MemoryEpisode,
    window: MemoryWindow,
  ): Promise<AssignWindowToEpisodeResult> {
    /*
     * The Window id is kept unique inside the Episode and all indexes
     * are rebuilt because the Window may have changed since the last
     * processing.
     */
    const rebuiltEpisode =
      await rebuildEpisode(episode, window);

    await saveEpisode(rebuiltEpisode);

    if (window.episodeId !== rebuiltEpisode.id) {
      await saveWindow({
        ...window,
        episodeId: rebuiltEpisode.id,
      });
    }

    return {
      episodeId: rebuiltEpisode.id,
      action: "updated",
      episode: cloneEpisode(rebuiltEpisode),
    };
  }

  private async appendWindowToEpisode(
    episode: MemoryEpisode,
    window: MemoryWindow,
  ): Promise<AssignWindowToEpisodeResult> {
    const previousEpisode =
      cloneEpisode(episode);

    const rebuiltEpisode =
      await rebuildEpisode(episode, window);

    /*
     * Write order:
     * 1. Episode receives the Window id.
     * 2. Window points back to the Episode.
     *
     * If the second write fails, the Episode is restored.
     */
    await saveEpisode(rebuiltEpisode);

    try {
      await saveWindow({
        ...window,
        episodeId: rebuiltEpisode.id,
      });
    } catch (error) {
      await this.restoreEpisode(
        previousEpisode,
        error,
      );

      throw error;
    }

    return {
      episodeId: rebuiltEpisode.id,
      action: "appended",
      episode: cloneEpisode(rebuiltEpisode),
    };
  }

  private async createNewEpisode(
    window: MemoryWindow,
    sessionId: string,
  ): Promise<AssignWindowToEpisodeResult> {
    const newEpisode = await createEpisode(
      window,
      sessionId,
    );

    /*
     * Write order:
     * 1. The new Episode is inserted.
     * 2. The Window points back to the Episode.
     *
     * If the second write fails, the Episode is removed again.
     */
    await saveEpisode(newEpisode);

    try {
      await saveWindow({
        ...window,
        episodeId: newEpisode.id,
      });
    } catch (error) {
      try {
        await deleteEpisodeById(
          newEpisode.id,
        );
      } catch (rollbackError) {
        throw new Error(
          [
            "Could not update the Window after Episode creation, and the Episode rollback also failed.",
            `Episode: ${newEpisode.id}`,
            `Original error: ${getErrorMessage(error)}`,
            `Rollback error: ${getErrorMessage(rollbackError)}`,
          ].join(" "),
        );
      }

      throw error;
    }

    return {
      episodeId: newEpisode.id,
      action: "created",
      episode: cloneEpisode(newEpisode),
    };
  }

  /**
   * Restores a previous Episode version after a failed write.
   *
   * If the rollback itself fails, a combined error is thrown so the
   * inconsistency is never silent.
   */
  private async restoreEpisode(
    previousEpisode: MemoryEpisode,
    originalError: unknown,
  ): Promise<void> {
    try {
      await saveEpisode(previousEpisode);
    } catch (rollbackError) {
      throw new Error(
        [
          "Could not update the Window after the Episode write, and the Episode rollback also failed.",
          `Episode: ${previousEpisode.id}`,
          `Original error: ${getErrorMessage(originalError)}`,
          `Rollback error: ${getErrorMessage(rollbackError)}`,
        ].join(" "),
      );
    }
  }

  private async runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    let releaseQueue:
      | (() => void)
      | undefined;

    const previousOperation =
      this.operationQueue;

    this.operationQueue =
      new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });

    await previousOperation;

    try {
      return await operation();
    } finally {
      releaseQueue?.();
    }
  }
}
