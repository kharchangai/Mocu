// window/boundaryDetection.ts

import { getAsyncLLM } from "../../../../services/ai/llm";
import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";
import type {
  BoundaryDecision,
  MemoryWindow,
  Turn,
  WindowManagerConfig,
} from "./types";
import {
  clamp,
  getErrorMessage,
} from "./helpers";
import {
  extractJSONObject,
  getLLMResponseText,
} from "./llmResponse";
import {
  calculateTextSimilarity,
  turnToText,
  windowToText,
} from "./windowText";

/* -------------------------------------------------------------------------- */
/* Internal Types                                                             */
/* -------------------------------------------------------------------------- */

type ParsedBoundaryResponse = {
  decision: "continue" | "boundary";
  confidence: number;
  reason: string;
};

/* -------------------------------------------------------------------------- */
/* LLM Boundary Detection                                                     */
/* -------------------------------------------------------------------------- */

function createBoundarySystemPrompt(): string {
  return `
You are a semantic hard-boundary detector for conversational memory.

A memory Window is a small sequence of adjacent conversation Turns that
share the same local task, subject, or semantic context.

Decide whether a new Turn should continue the current Window or begin
a new Window.

Return only valid JSON.
Do not return Markdown.
Do not wrap the JSON in a code block.
`.trim();
}

function createBoundaryPrompt(
  window: MemoryWindow,
  newTurn: Turn,
  similarity: number,
  recentTurnCount: number,
): string {
  return `
Determine whether the NEW TURN should remain in the CURRENT WINDOW or
whether the current Window should be closed and a new Window created.

Decision rules:

1. Return "continue" when the new Turn:
   - continues the same task;
   - asks for the next implementation step;
   - fixes, tests, explains, or extends the current work;
   - depends on the current Window for understanding;
   - changes a subtopic but remains part of the same local task.

2. Return "boundary" when the new Turn:
   - begins a different and semantically independent task;
   - changes to an unrelated subject;
   - no longer needs the current Window to be understood;
   - explicitly abandons the current task and starts another task.

3. Do not create a boundary only because the user says:
   - "now";
   - "next";
   - "let us move to";
   - "حالا";
   - "بریم سراغ".

The semantic relationship is more important than transition words.

The similarity score is supporting evidence only.
Do not use it as the only reason for your decision.

Similarity score:
${similarity.toFixed(4)}

CURRENT WINDOW:
${windowToText(window, recentTurnCount)}

NEW TURN:
${turnToText(newTurn)}

Return exactly one JSON object:

{
  "decision": "continue" or "boundary",
  "confidence": a number from 0 to 1,
  "reason": "a short explanation in English"
}
`.trim();
}

export function parseBoundaryDecision(
  llmResponse: unknown,
  similarity: number,
): BoundaryDecision {
  const responseText =
    getLLMResponseText(llmResponse);

  if (!responseText.trim()) {
    throw new Error(
      "The LLM returned an empty response.",
    );
  }

  const jsonText =
    extractJSONObject(responseText);

  const parsedValue: unknown =
    JSON.parse(jsonText);

  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  ) {
    throw new Error(
      "The LLM boundary response is not an object.",
    );
  }

  const candidate =
    parsedValue as Record<string, unknown>;

  if (
    candidate.decision !== "continue" &&
    candidate.decision !== "boundary"
  ) {
    throw new Error(
      'The LLM decision must be "continue" or "boundary".',
    );
  }

  const confidence =
    Number(candidate.confidence);

  const parsedResponse: ParsedBoundaryResponse = {
    decision: candidate.decision,

    confidence: Number.isFinite(confidence)
      ? clamp(confidence, 0, 1)
      : 0.5,

    reason:
      typeof candidate.reason === "string" &&
      candidate.reason.trim()
        ? candidate.reason.trim()
        : "No reason was returned by the LLM.",
  };

  return {
    ...parsedResponse,
    similarity,
  };
}

function createFallbackBoundaryDecision(
  similarity: number,
  threshold: number,
  error: unknown,
): BoundaryDecision {
  const shouldCreateBoundary =
    similarity < threshold;

  const distanceFromThreshold =
    Math.abs(similarity - threshold);

  return {
    decision: shouldCreateBoundary
      ? "boundary"
      : "continue",

    confidence: clamp(
      distanceFromThreshold,
      0,
      1,
    ),

    reason: [
      "The LLM boundary decision failed.",
      "The similarity fallback rule was used.",
      `Error: ${getErrorMessage(error)}`,
    ].join(" "),

    similarity,
  };
}

export async function detectBoundary(
  window: MemoryWindow,
  newTurn: Turn,
  config: WindowManagerConfig,
): Promise<BoundaryDecision> {
  let similarity = 0;

  try {
    similarity =
      await calculateTextSimilarity(
        window,
        newTurn,
        config.recentTurnsForBoundary,
      );
  } catch (textSimilarityError) {
    try {
      similarity = clamp(
        textSimilarity
          .compareEmbeddingToEmbedding(
            window.indexes.embedding,
            newTurn.indexes.embedding,
          ),
        0,
        1,
      );
    } catch (embeddingSimilarityError) {
      throw new Error(
        [
          "Could not calculate boundary similarity.",
          `Text similarity error: ${getErrorMessage(textSimilarityError)}`,
          `Embedding similarity error: ${getErrorMessage(embeddingSimilarityError)}`,
        ].join(" "),
      );
    }
  }

  const prompt =
    createBoundaryPrompt(
      window,
      newTurn,
      similarity,
      config.recentTurnsForBoundary,
    );

  try {
    const llm =
      await getAsyncLLM("medium", {
        temperature: 0,
        systemPrompt:
          createBoundarySystemPrompt(),
      });

    const response =
      await llm.invoke([
        {
          role: "system",
          content:
            createBoundarySystemPrompt(),
        },
        {
          role: "user",
          content: prompt,
        },
      ]);

    return parseBoundaryDecision(
      response,
      similarity,
    );
  } catch (error) {
    return createFallbackBoundaryDecision(
      similarity,
      config.fallbackSimilarityThreshold,
      error,
    );
  }
}
