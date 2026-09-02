// episode/episodeSubject.ts

import { getAsyncLLM } from "../../../../services/ai/llm";
import {
  extractJSONObject,
  getLLMResponseText,
} from "../window/llmResponse";
import { uniqueStrings } from "../window/helpers";
import type { EpisodeWindowSummary } from "./types";

/* -------------------------------------------------------------------------- */
/* LLM General Subject Detection                                              */
/* -------------------------------------------------------------------------- */

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function createSubjectSystemPrompt(): string {
  return `
You are a memory index assistant for conversational memory.

You receive the compact indexes of several memory Windows that were
created from adjacent conversation Turns.

Your task is to return one general subject that represents the broader
activity shared by all of the given Windows.

Rules:
- The general subject must be a short phrase, not a full sentence.
- The general subject must be in the same language as the Window subjects.
- The general subject must be broader than each individual Window subject.
- Do not join unrelated activities into one subject.
- Do not add information that is not present in the Window indexes.

Return only valid JSON.
Do not return Markdown.
Do not wrap the JSON in a code block.
`.trim();
}

function createSubjectPrompt(
  windowSummaries: EpisodeWindowSummary[],
): string {
  const compactInput = {
    windows: windowSummaries,
  };

  return `
Below are the compact indexes of all Windows in the current Episode.

WINDOW INDEXES:
${JSON.stringify(compactInput, null, 2)}

Return exactly one JSON object:

{
  "subject": "the one general subject that covers all Window subjects"
}
`.trim();
}

function parseSubjectResponse(
  llmResponse: unknown,
): string {
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

  if (!isRecord(parsedValue)) {
    throw new Error(
      "The LLM subject response is not an object.",
    );
  }

  if (
    typeof parsedValue.subject !== "string" ||
    !parsedValue.subject.trim()
  ) {
    throw new Error(
      "The LLM subject response must contain a non-empty subject.",
    );
  }

  return parsedValue.subject.trim();
}

/**
 * Creates the general subject of an Episode from the compact indexes
 * of its member Windows.
 *
 * A single Window subject is returned directly without an LLM call.
 * If the LLM request fails, the subject of the first Window is used as
 * a deterministic fallback so Episode creation never breaks. The first
 * Window is the activity that started the Episode.
 */
export async function createEpisodeSubject(
  windowSummaries: EpisodeWindowSummary[],
): Promise<string> {
  const windowSubjects =
    uniqueStrings(
      windowSummaries.map(
        (summary) => summary.subject,
      ),
    );

  if (windowSubjects.length === 0) {
    throw new Error(
      "The Window subjects cannot be empty.",
    );
  }

  if (windowSubjects.length === 1) {
    const onlySubject = windowSubjects[0];

    if (!onlySubject) {
      throw new Error(
        "The Window subject cannot be empty.",
      );
    }

    return onlySubject;
  }

  const systemPrompt =
    createSubjectSystemPrompt();

  try {
    const llm =
      await getAsyncLLM("medium", {
        temperature: 0,
        systemPrompt,
      });

    const response =
      await llm.invoke([
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: createSubjectPrompt(
            windowSummaries,
          ),
        },
      ]);

    return parseSubjectResponse(response);
  } catch (error) {
    /*
     * Deterministic fallback: the subject of the first Window.
     */
    const fallbackSubject =
      windowSubjects[0];

    if (!fallbackSubject) {
      throw new Error(
        `Could not create the Episode general subject: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    return fallbackSubject;
  }
}
