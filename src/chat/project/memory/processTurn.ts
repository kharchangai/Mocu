// processTurn.ts

/**
 * High-level processing pipeline for the memory hierarchy:
 *
 * User message + Agent response
 *   -> create Turn
 *   -> assign Turn to Window
 *   -> assign the current Window to its Episode (every turn)
 *   -> when the previous Window was closed, assign it to its Episode too
 *   -> return ids
 *
 * The Episode layer runs on every turn exactly like the Window layer,
 * so Turn, Window, and Episode are always persisted together in the
 * same database.
 */

import { createTurn } from "./createTurn";
import {
  addTurnToWindow,
  type MemoryWindow,
} from "./window";
import {
  assignWindowToEpisode,
  type EpisodeAction,
} from "./episode";

export interface ProcessTurnResult {
  turnId: string;
  windowId: string;
  windowAction: "created" | "appended";

  /**
   * Episode of the current Window.
   *
   * Set on every turn, exactly like windowId, because the Episode
   * layer is persisted on every turn together with the Turn and the
   * Window.
   */
  episodeId?: string;

  /**
   * How the Episode of the current Window was persisted:
   * "created", "appended", or "updated".
   */
  episodeAction?: EpisodeAction;

  /**
   * Only set when the Window processing produced a closed Window that
   * was assigned to the Episode layer in this turn.
   */
  closedEpisodeId?: string;

  /**
   * How the closed Window was persisted in its Episode.
   */
  closedEpisodeAction?: EpisodeAction;
}

/**
 * Creates a Turn, stores it in a Window, and keeps both the Window and
 * its Episode persisted on every turn.
 *
 * The existing public APIs (createTurn, addTurnToWindow, and
 * assignWindowToEpisode) are used unchanged.
 */
export async function processTurn(
  userMessage: string,
  agentResponse: string,
): Promise<ProcessTurnResult> {
  const turnResult = await createTurn(
    userMessage,
    agentResponse,
  );

  const windowResult =
    await addTurnToWindow(turnResult.turn);

  const result: ProcessTurnResult = {
    turnId: turnResult.turnId,
    windowId: windowResult.windowId,
    windowAction: windowResult.action,
  };

  /*
   * 1. When the previous Window was closed, it is assigned to its
   *    Episode first. The current Window can then match against
   *    up-to-date Episode indexes.
   */
  const closedWindow:
    | MemoryWindow
    | undefined =
    windowResult.episodeInput?.window;

  if (closedWindow) {
    const closedEpisodeResult =
      await assignWindowToEpisode(
        closedWindow,
      );

    result.closedEpisodeId =
      closedEpisodeResult.episodeId;

    result.closedEpisodeAction =
      closedEpisodeResult.action;
  }

  /*
   * 2. The current Window is assigned to its Episode on every turn,
   *    exactly like the Window layer stores the Turn on every turn.
   *
   * - An open Window without an Episode creates or joins one.
   * - An open Window with a stored Episode reference updates that
   *   Episode with the latest Window content.
   * - The new Window created after a boundary joins the best matching
   *   open Episode or creates a new one.
   */
  const currentWindow:
    | MemoryWindow
    | undefined =
    windowResult.window;

  if (currentWindow) {
    const episodeResult =
      await assignWindowToEpisode(
        currentWindow,
      );

    result.episodeId =
      episodeResult.episodeId;

    result.episodeAction =
      episodeResult.action;
  }

  return result;
}
