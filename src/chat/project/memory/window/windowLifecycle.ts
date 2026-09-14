// window/windowLifecycle.ts

import type {
  EpisodeWindowInput,
  MemoryWindow,
  Turn,
  WindowBoundaryReason,
} from "./types";
import { createWindowId } from "./helpers";
import {
  createWindowIndexes,
  updateWindowIndexes,
} from "./windowIndexes";

/* -------------------------------------------------------------------------- */
/* Window Lifecycle                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates a new open Window from its first Turn.
 */
export async function createWindow(
  turn: Turn,
): Promise<MemoryWindow> {
  const now = new Date().toISOString();

  return {
    id: createWindowId(),
    turns: [turn],
    indexes: await createWindowIndexes(turn),
    status: "open",
    estimatedTokens: turn.estimatedTokens,
    startedAt: now,
    updatedAt: now,
  };
}

export async function appendTurn(
  window: MemoryWindow,
  turn: Turn,
): Promise<MemoryWindow> {
  if (window.status !== "open") {
    throw new Error(
      "A Turn cannot be appended to a closed Window.",
    );
  }

  return {
    ...window,

    turns: [
      ...window.turns,
      turn,
    ],

    indexes: await updateWindowIndexes(
      window,
      turn,
    ),

    estimatedTokens:
      window.estimatedTokens +
      turn.estimatedTokens,

    updatedAt: new Date().toISOString(),
  };
}

export function closeWindow(
  window: MemoryWindow,
  reason: WindowBoundaryReason,
  closedAt = new Date().toISOString(),
): MemoryWindow {
  if (window.status === "closed") {
    return window;
  }

  return {
    ...window,
    status: "closed",
    updatedAt: closedAt,
    closedAt,
    boundaryReason: reason,
  };
}

export function createEpisodeInput(
  closedWindow: MemoryWindow,
): EpisodeWindowInput {
  if (closedWindow.status !== "closed") {
    throw new Error(
      "Only a closed Window can be sent to EpisodeManager.",
    );
  }

  if (!closedWindow.boundaryReason) {
    throw new Error(
      "A closed Window must contain a boundary reason.",
    );
  }

  return {
    window: closedWindow,
    boundaryReason:
      closedWindow.boundaryReason,
    readyAt:
      closedWindow.closedAt ??
      closedWindow.updatedAt,
  };
}
