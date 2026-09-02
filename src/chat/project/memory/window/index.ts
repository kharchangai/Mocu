// window/index.ts

/**
 * Public API of the Window layer.
 */

import { WindowManager } from "./WindowManager";
import type {
  AddTurnToWindowResult,
  BoundaryDecision,
  CloseOpenWindowResult,
  EpisodeWindowInput,
  MemoryWindow,
  Turn,
  TurnIndexes,
  WindowBoundaryReason,
  WindowEntity,
  WindowIndexes,
  WindowManagerConfig,
  WindowStatus,
} from "./types";

export type {
  AddTurnToWindowResult,
  BoundaryDecision,
  CloseOpenWindowResult,
  EpisodeWindowInput,
  MemoryWindow,
  Turn,
  TurnIndexes,
  WindowBoundaryReason,
  WindowEntity,
  WindowIndexes,
  WindowManagerConfig,
  WindowStatus,
};

export { WINDOW_RECORD_TYPE } from "./windowStorage";
export { WindowManager } from "./WindowManager";

/* -------------------------------------------------------------------------- */
/* Default Instance and Simple API                                            */
/* -------------------------------------------------------------------------- */

export const windowManager =
  new WindowManager();

/**
 * Main function called after a Turn has been created.
 *
 * It stores the Turn inside a Window, persists the Window in the SQLite
 * database, and returns the database id of the affected Window.
 */
export async function addTurnToWindow(
  turn: Turn,
): Promise<AddTurnToWindowResult> {
  return windowManager.addTurn(turn);
}

export async function getAllWindows(): Promise<
  MemoryWindow[]
> {
  return windowManager.getAllWindows();
}

export async function getOpenWindow(): Promise<
  MemoryWindow | null
> {
  return windowManager.getOpenWindow();
}

export async function getClosedWindows(): Promise<
  MemoryWindow[]
> {
  return windowManager.getClosedWindows();
}

export async function getEpisodeInputs(): Promise<
  EpisodeWindowInput[]
> {
  return windowManager.getEpisodeInputs();
}

export async function closeOpenWindow(): Promise<
  CloseOpenWindowResult | null
> {
  return windowManager.closeOpenWindow();
}

export async function clearWindows(): Promise<void> {
  await windowManager.clearWindows();
}
