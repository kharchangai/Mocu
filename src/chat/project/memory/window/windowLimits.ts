// window/windowLimits.ts

import type {
  MemoryWindow,
  Turn,
  WindowBoundaryReason,
  WindowManagerConfig,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Deterministic Limits                                                       */
/* -------------------------------------------------------------------------- */

export function getLimitBoundaryReason(
  window: MemoryWindow,
  newTurn: Turn,
  config: WindowManagerConfig,
): WindowBoundaryReason | null {
  if (
    window.turns.length >=
    config.maximumTurns
  ) {
    return "maximum_turns";
  }

  const nextTokenCount =
    window.estimatedTokens +
    newTurn.estimatedTokens;

  if (
    nextTokenCount >
    config.maximumTokens
  ) {
    return "maximum_tokens";
  }

  return null;
}
