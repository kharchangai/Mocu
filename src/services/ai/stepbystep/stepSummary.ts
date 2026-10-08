import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

import type { StepMemory } from "./types";

/**
 * Shared by Step and Focus. Any log entry with an ID, a kind and data can be
 * summarized, so both session types use the same summarizer and budget.
 */
export interface HistoryEntryLike {
  id: string;
  kind: string;
  data: unknown;
}

/** Maximum characters of one section's history sent to a model at once. */
export const STEP_HISTORY_MAX_CHARS = 40_000;

const TOOL_ARG_PREVIEW_CHARS = 300;
const TOOL_RESULT_PREVIEW_CHARS = 800;
const TRANSCRIPT_HEAD_CHARS = 8_000;
const SUMMARY_ATTEMPTS = 2;
const FALLBACK_OUTCOME_CHARS = 1_500;

export const EMPTY_STEP_OUTCOME = "این بخش بدون کار ثبت‌شده تمام شد.";

const StepSummarySchema = z.object({
  outcome: z.string(),
  decisions: z.array(z.string()).default([]),
  artifacts: z.array(z.string()).default([]),
  openItems: z.array(z.string()).default([]),
  evidenceLogIds: z.array(z.string()).default([]),
});

const SUMMARY_INSTRUCTIONS = `You summarize ONE finished work section of an agent session (a step of a step-by-step session, or a section of a Focus session).
You receive the section title, its goal and a transcript of everything that happened in it.
Each transcript line may carry a logId. Tool results are previews; their logId lets a later agent read the full output. Milestone lines are results the agent marked as important.

Return ONLY a JSON object with these keys:
- "outcome": string. 2 to 6 sentences: what was accomplished and the final state of the work.
- "decisions": string[]. Important decisions the user or the agent made.
- "artifacts": string[]. Files or items created or changed, each with a short note of the change (for example a file path).
- "openItems": string[]. Unresolved problems, pending user actions, or things that were not verified.
- "evidenceLogIds": string[]. logIds of tool results that contain exact details needed later (for example command output, errors, or file contents). Only IDs that appear in the transcript.

Rules:
- Use only facts present in the transcript. Do not guess or invent file names, values, or results.
- If the transcript shows a request that was not completed, say so in "outcome" and "openItems".
- Write the text values in the same language the user used in the transcript.
- Output the JSON object only, with no markdown and no extra text.`;

export interface SummaryModel {
  invoke(messages: BaseMessage[]): Promise<{ content: unknown }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function textOf(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}…[truncated]`;
}

/**
 * Keeps the newest complete turns within the character budget. A turn starts
 * at a user message, so tool calls and their results are never split from the
 * turn that produced them. The newest turn is always kept, even when it alone
 * exceeds the budget. Returns the input unchanged when nothing is dropped.
 */
export function limitHistoryToBudget<T extends HistoryEntryLike>(
  entries: T[],
  maxChars = STEP_HISTORY_MAX_CHARS,
): T[] {
  const turnStarts: number[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "user") turnStarts.push(index);
  });
  if (turnStarts.length === 0) return entries;

  let used = 0;
  let keepFrom = 0;
  let dropped = false;

  for (let t = turnStarts.length - 1; t >= 0; t -= 1) {
    const start = turnStarts[t];
    const end = t === turnStarts.length - 1 ? entries.length : turnStarts[t + 1];
    let size = 0;
    for (let i = start; i < end; i += 1) {
      size += textOf(entries[i].data).length;
    }
    // The newest turn is always kept.
    if (t !== turnStarts.length - 1 && used + size > maxChars) {
      dropped = true;
      break;
    }
    used += size;
    keepFrom = start;
  }

  return dropped ? entries.slice(keepFrom) : entries;
}

/**
 * Builds a compact, ordered transcript of one section. Tool results are shown
 * as previews with their log IDs. When the transcript is too long, the
 * beginning (original goal) and the end (latest outcome) are kept and the
 * middle is marked as omitted.
 */
export function buildStepTranscript(
  entries: HistoryEntryLike[],
  maxChars = STEP_HISTORY_MAX_CHARS,
): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const data = asRecord(entry.data);

    if (entry.kind === "user" && typeof data.message === "string") {
      lines.push(`[user] ${data.message}`);
    } else if (entry.kind === "assistant" && typeof data.reply === "string") {
      lines.push(`[assistant] ${data.reply}`);
    } else if (entry.kind === "milestone" && typeof data.summary === "string") {
      lines.push(`[milestone] ${data.summary}`);
    } else if (entry.kind === "tool_call") {
      lines.push(
        `[tool_call ${textOf(data.name)} logId=${entry.id}] args: ${clip(textOf(data.arguments), TOOL_ARG_PREVIEW_CHARS)}`,
      );
    } else if (entry.kind === "tool_result") {
      lines.push(
        `[tool_result ${textOf(data.name)} logId=${entry.id}] ${clip(textOf(data.result), TOOL_RESULT_PREVIEW_CHARS)}`,
      );
    } else if (entry.kind === "error" && typeof data.message === "string") {
      lines.push(`[error] ${data.message}`);
    }
  }

  const transcript = lines.join("\n");
  if (transcript.length <= maxChars) return transcript;

  const marker =
    "\n[... middle of the section omitted for length; use the history tools to review it ...]\n";
  const tailChars = Math.max(maxChars - TRANSCRIPT_HEAD_CHARS - marker.length, 0);

  return `${transcript.slice(0, TRANSCRIPT_HEAD_CHARS)}${marker}${transcript.slice(transcript.length - tailChars)}`;
}

/** Cheap, model-free summary used when the summarizer fails. */
export function fallbackStepMemory(entries: HistoryEntryLike[]): StepMemory {
  const lastReply = [...entries]
    .reverse()
    .find((entry) => entry.kind === "assistant" && typeof asRecord(entry.data).reply === "string");

  return {
    outcome: lastReply
      ? String(asRecord(lastReply.data).reply).slice(0, FALLBACK_OUTCOME_CHARS)
      : "",
    decisions: [],
    artifacts: [],
    openItems: [],
    evidenceLogIds: [],
  };
}

function parseSummaryJson(text: string): z.infer<typeof StepSummarySchema> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end <= start) {
    throw new Error("Summary response has no JSON object.");
  }

  const result = StepSummarySchema.safeParse(
    JSON.parse(text.slice(start, end + 1)),
  );

  if (!result.success || !result.data.outcome.trim()) {
    throw new Error("Summary response is invalid.");
  }

  return result.data;
}

/**
 * Summarizes a finished section from its full history. The model is asked for
 * structured JSON. Evidence IDs are filtered to IDs that really exist in the
 * section so the summary cannot point to invented logs.
 *
 * Throws when every attempt fails; the caller decides the fallback.
 */
export async function summarizeStepHistory(input: {
  model: SummaryModel;
  entries: HistoryEntryLike[];
  stepTitle: string;
  stepGoal: string;
}): Promise<StepMemory> {
  if (input.entries.length === 0) {
    return {
      outcome: EMPTY_STEP_OUTCOME,
      decisions: [],
      artifacts: [],
      openItems: [],
      evidenceLogIds: [],
    };
  }

  const validIds = new Set(input.entries.map((entry) => entry.id));
  const messages: BaseMessage[] = [
    new SystemMessage(SUMMARY_INSTRUCTIONS),
    new HumanMessage(
      `SECTION: ${input.stepTitle}\nSECTION GOAL: ${input.stepGoal}\n\nTRANSCRIPT:\n${buildStepTranscript(input.entries)}`,
    ),
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt < SUMMARY_ATTEMPTS; attempt += 1) {
    try {
      const response = await input.model.invoke(messages);
      const parsed = parseSummaryJson(textOf(response.content));

      return {
        outcome: parsed.outcome.trim(),
        decisions: parsed.decisions,
        artifacts: parsed.artifacts,
        openItems: parsed.openItems,
        evidenceLogIds: parsed.evidenceLogIds.filter((id) => validIds.has(id)),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}
