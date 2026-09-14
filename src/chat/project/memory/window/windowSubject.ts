// window/windowSubject.ts

import { getAsyncLLM } from "../../../../services/ai/llm";
import {
  extractJSONObject,
  getLLMResponseText,
} from "./llmResponse";
import { uniqueStrings } from "./helpers";

/* -------------------------------------------------------------------------- */
/* LLM Main Subject Detection                                                 */
/* -------------------------------------------------------------------------- */

function createSubjectSystemPrompt(): string {
  return `
You are a memory index assistant for conversational memory.

You receive the subjects of several adjacent conversation Turns that
belong to the same memory Window.

Your task is to return exactly one main subject that comprehensively
represents the combined meaning of all of the given Turn subjects.

Rules:
- Return exactly one subject that covers the shared meaning of every
  Turn subject together, as if summarizing what the whole Window is
  about in a single phrase.
- The main subject must be a short phrase, not a full sentence.
- The main subject must be in the same language as the Turn subjects.
- The main subject must be generic enough to cover every Turn subject,
  but specific enough to stay meaningful.
- Do not list the Turn subjects; merge them into one phrase.
- Do not add information that is not present in the Turn subjects.

Return only valid JSON.
Do not return Markdown.
Do not wrap the JSON in a code block.
`.trim();
}

function createSubjectPrompt(
  turnSubjects: string[],
): string {
  const subjectList = turnSubjects
    .map(
      (subject, index) =>
        `${index + 1}. ${subject}`,
    )
    .join("\n");

  return `
Below are the subjects of all Turns in the current Window.

TURN SUBJECTS:
${subjectList}

Merge the shared meaning of all Turn subjects above into exactly one
comprehensive subject that represents what every Turn is about.

Return exactly one JSON object:

{
  "subject": "the one comprehensive subject covering the combined meaning of all Turns"
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

  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  ) {
    throw new Error(
      "The LLM subject response is not an object.",
    );
  }

  const candidate =
    parsedValue as Record<string, unknown>;

  if (
    typeof candidate.subject !== "string" ||
    !candidate.subject.trim()
  ) {
    throw new Error(
      "The LLM subject response must contain a non-empty subject.",
    );
  }

  return candidate.subject.trim();
}

/**
 * Sends all Turn subjects of a Window to the LLM and returns exactly
 * one comprehensive main subject that captures the combined meaning of
 * every Turn in the Window.
 *
 * A single Turn subject is returned directly without an LLM call.
 * If the LLM request fails, the most recent Turn subject is used as a
 * deterministic fallback so Window creation never breaks.
 */
export async function createWindowMainSubject(
  turnSubjects: string[],
): Promise<string> {
  const uniqueSubjects =
    uniqueStrings(turnSubjects);

  if (uniqueSubjects.length === 0) {
    throw new Error(
      "The Turn subjects cannot be empty.",
    );
  }

  if (uniqueSubjects.length === 1) {
    const onlySubject = uniqueSubjects[0];

    if (!onlySubject) {
      throw new Error(
        "The Turn subject cannot be empty.",
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
            uniqueSubjects,
          ),
        },
      ]);

    return parseSubjectResponse(response);
  } catch (error) {
    /*
     * Deterministic fallback: the most recent Turn subject.
     */
    const fallbackSubject =
      uniqueSubjects[uniqueSubjects.length - 1];

    if (!fallbackSubject) {
      throw new Error(
        `Could not create the Window main subject: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    return fallbackSubject;
  }
}
