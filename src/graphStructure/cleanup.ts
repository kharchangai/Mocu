// src/graphStructure/cleanup.ts
//
// JEV-based cleanup of one agent run's raw records.
//
// Goal: before persisting a run into the graph, drop the extra work the
// model did while it was still figuring out project structure, and keep
// only the tool calls that were genuinely useful — so a future agent does
// not repeat them.
//
// Rules:
//   - model_call records are always dropped (rule, no JEV call): those
//     intermediate checks are exactly the extra work we remove.
//   - tool_call records are judged one by one by JEV with two yes/no
//     questions in a single call per tool:
//       usefulForRun       -> did the output help reach the final answer?
//       usefulForStructure -> does it hold reusable project-structure
//                             knowledge (paths, layout, file contents,
//                             search results)?
//     keep when either probability is >= 0.5.
//   - duplicate tool calls (same tool + normalized args already kept)
//     are dropped without calling JEV.
//   - JEV failures fail open: the tool call is kept and the error is
//     recorded in the decision. Losing good data is worse than keeping
//     one extra node.
//
// The complete user request and final answer stay in the internal graph for similarity matching; agent-facing retrieval omits both.

import { getJevDecision } from "../services/ai/tools/decision/Jev_model";
import type { GraphRecord } from "./recorder";

/** Maximum characters of a tool result sent to JEV. */
const RESULT_PREVIEW_LIMIT = 2000;

/** Lower threshold keeps borderline-useful calls; JEV failures remain fail-open. */
const KEEP_PROBABILITY = 0.35;

export type CleanupDecisionReason =
  | "jev"
  | "duplicate"
  | "model_call_rule"
  | "jev_error";

export type CleanupDecision = {
  /** tool_call_id for tool records; node id for model calls. */
  recordId: string;
  tool?: string;
  keep: boolean;
  reason: CleanupDecisionReason;
  /** JEV yes probabilities, present when reason is "jev". */
  usefulForRun?: number;
  usefulForStructure?: number;
  /** Populated when reason is "jev_error" (fail-open kept the record). */
  error?: string;
};

export type CleanupResult = {
  /** Records to persist: run_start, run_end, and kept tool_calls. */
  kept: GraphRecord[];
  /** Records removed from the persisted run. */
  dropped: GraphRecord[];
  decisions: CleanupDecision[];
};

const truncateForPrompt = (value: string | undefined): string => {
  if (!value) {
    return "";
  }
  if (value.length <= RESULT_PREVIEW_LIMIT) {
    return value;
  }
  return `${value.slice(0, RESULT_PREVIEW_LIMIT)}… [truncated]`;
};

/** Stable stringify so key order does not change the duplicate check. */
const normalizeArgs = (args: unknown): string => {
  if (args === undefined) {
    return "";
  }
  try {
    return JSON.stringify(args, (_key, value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return Object.keys(record)
          .sort()
          .reduce<Record<string, unknown>>((sorted, key) => {
            sorted[key] = record[key];
            return sorted;
          }, {});
      }
      return value;
    });
  } catch {
    return String(args);
  }
};

type MergedTool = {
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  status: string;
  records: GraphRecord[];
};

/** Groups tool_call records by id, keeping first-seen order. */
const collectToolCalls = (records: readonly GraphRecord[]): MergedTool[] => {
  const byId = new Map<string, MergedTool>();

  for (const record of records) {
    if (record.type !== "tool_call") {
      continue;
    }
    const existing = byId.get(record.id);
    if (!existing) {
      byId.set(record.id, {
        id: record.id,
        tool: record.tool,
        ...(record.args !== undefined ? { args: record.args } : {}),
        ...(record.result !== undefined ? { result: record.result } : {}),
        status: record.status,
        records: [record],
      });
      continue;
    }
    if (record.args !== undefined) {
      existing.args = record.args;
    }
    if (record.result !== undefined) {
      existing.result = record.result;
    }
    existing.status = record.status;
    existing.records.push(record);
  }

  return [...byId.values()];
};

type JevNoulAnswer = { noul?: unknown };

const readNoulProbability = (
  answers: Record<string, unknown>,
  key: string,
): number => {
  const answer = answers[key];
  if (!answer || typeof answer !== "object" || !("noul" in answer)) {
    throw new Error(`JEV response is missing "${key}".`);
  }
  const probability = (answer as JevNoulAnswer).noul;
  if (
    typeof probability !== "number" ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  ) {
    throw new Error(`JEV returned an invalid yes probability for "${key}".`);
  }
  return probability;
};

/**
 * Asks JEV whether one tool call was worth keeping, given the user's
 * request and the final answer. Returns both calibrated probabilities.
 */
const judgeToolCall = async (input: {
  userMessage: string;
  finalAnswer: string;
  tool: MergedTool;
}): Promise<{ usefulForRun: number; usefulForStructure: number }> => {
  const result: unknown = await getJevDecision({
    state: {
      userMessage: input.userMessage,
      finalAnswer: input.finalAnswer,
      tool: input.tool.tool,
      args: input.tool.args ?? {},
      result: truncateForPrompt(input.tool.result),
    },
    questions: {
      usefulForRun: {
        type: "noul",
        instructions:
          "Could this tool call, its inputs, or its output be useful evidence for a future similar user request, either by avoiding repeated work or supplying relevant context? Prefer retaining plausible candidates over dropping them.",
        criteria: {
          true: "This tool call plausibly helps with a future similar request, including an action, a read, a search, or an intermediate step.",
          false: "This tool call is clearly unrelated, redundant, or useless for future work.",
        },
      },
      usefulForStructure: {
        type: "noul",
        instructions:
          "Does this call contain reusable information about files, project layout, configuration, or other context that may help future similar work?",
        criteria: {
          true: "It contains potentially reusable contextual information.",
          false: "It contains no reusable contextual information.",
        },
      },
    },
  });
  if (!result || typeof result !== "object" || !("answers" in result)) {
    throw new Error("JEV returned an unexpected decision response.");
  }
  const answers = (result as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object") {
    throw new Error("JEV response is missing answers.");
  }

  const record = answers as Record<string, unknown>;
  return {
    usefulForRun: readNoulProbability(record, "usefulForRun"),
    usefulForStructure: readNoulProbability(record, "usefulForStructure"),
  };
};

/**
 * Filters one run's raw records down to what is worth persisting.
 * Pure bookkeeping around JEV: same inputs, same keep/drop structure
 * (JEV probabilities themselves are model output).
 */
export const cleanRunRecords = async (
  records: readonly GraphRecord[],
): Promise<CleanupResult> => {
  const startRecord = records.find((record) => record.type === "run_start");
  const userMessage =
    startRecord && startRecord.type === "run_start"
      ? startRecord.userMessage
      : "";
  const endRecord = records.find((record) => record.type === "run_end");
  const finalAnswer =
    endRecord && endRecord.type === "run_end" ? endRecord.finalAnswer : "";

  const toolCalls = collectToolCalls(records);
  const decisions: CleanupDecision[] = [];
  const keptToolIds = new Set<string>();
  /** tool+args keys already accepted, used to drop duplicates for free. */
  const seenKeepKeys = new Set<string>();

  for (const tool of toolCalls) {
    const dedupeKey = `${tool.tool}:${normalizeArgs(tool.args)}`;

    if (seenKeepKeys.has(dedupeKey)) {
      decisions.push({
        recordId: tool.id,
        tool: tool.tool,
        keep: false,
        reason: "duplicate",
      });
      continue;
    }

    try {
      const { usefulForRun, usefulForStructure } = await judgeToolCall({
        userMessage,
        finalAnswer,
        tool,
      });
      const keep =
        usefulForRun >= KEEP_PROBABILITY ||
        usefulForStructure >= KEEP_PROBABILITY;

      decisions.push({
        recordId: tool.id,
        tool: tool.tool,
        keep,
        reason: "jev",
        usefulForRun,
        usefulForStructure,
      });

      if (keep) {
        keptToolIds.add(tool.id);
        seenKeepKeys.add(dedupeKey);
      }
    } catch (error) {
      // Fail open: keep the record and remember why.
      decisions.push({
        recordId: tool.id,
        tool: tool.tool,
        keep: true,
        reason: "jev_error",
        error: error instanceof Error ? error.message : String(error),
      });
      keptToolIds.add(tool.id);
      seenKeepKeys.add(dedupeKey);
    }
  }

  const kept: GraphRecord[] = [];
  const dropped: GraphRecord[] = [];

  for (const record of records) {
    if (record.type === "run_start" || record.type === "run_end") {
      kept.push(record);
      continue;
    }
    if (record.type === "model_call") {
      dropped.push(record);
      decisions.push({
        recordId: `model:${record.index}`,
        keep: false,
        reason: "model_call_rule",
      });
      continue;
    }
    if (record.type === "tool_call") {
      if (keptToolIds.has(record.id)) {
        kept.push(record);
      } else {
        dropped.push(record);
      }
    }
  }

  return { kept, dropped, decisions };
};
