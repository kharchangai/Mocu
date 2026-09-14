// window/windowText.ts

import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";
import type { MemoryWindow, Turn } from "./types";
import { clamp, isFiniteNumber } from "./helpers";

/* -------------------------------------------------------------------------- */
/* Text Representation                                                        */
/* -------------------------------------------------------------------------- */

export function turnToText(turn: Turn): string {
  return [
    `Subject: ${turn.indexes.subject}`,
    `Type: ${turn.indexes.type}`,
    `Keywords: ${turn.indexes.keywords.join(", ")}`,
    `User: ${turn.userMessage}`,
    `Assistant: ${turn.agentResponse}`,
  ].join("\n");
}

export function windowToText(
  window: MemoryWindow,
  recentTurnCount: number,
): string {
  const recentTurns = window.turns.slice(
    -recentTurnCount,
  );

  const recentTurnTexts =
    recentTurns.map((turn, index) =>
      [
        `Recent Turn ${index + 1}:`,
        turnToText(turn),
      ].join("\n"),
    );

  return [
    `Window subjects: ${window.indexes.subjects.join(", ")}`,
    `Window types: ${window.indexes.types.join(", ")}`,
    `Window keywords: ${window.indexes.keywords.join(", ")}`,
    "",
    ...recentTurnTexts,
  ].join("\n\n");
}

/* -------------------------------------------------------------------------- */
/* Similarity                                                                 */
/* -------------------------------------------------------------------------- */

export async function calculateTextSimilarity(
  window: MemoryWindow,
  turn: Turn,
  recentTurnCount: number,
): Promise<number> {
  const currentWindowText =
    windowToText(
      window,
      recentTurnCount,
    );

  const newTurnText =
    turnToText(turn);

  const result =
    await textSimilarity.compareTextToText(
      currentWindowText,
      newTurnText,
    );

  if (!isFiniteNumber(result.score)) {
    throw new Error(
      "Text similarity returned an invalid score.",
    );
  }

  return clamp(result.score, 0, 1);
}
