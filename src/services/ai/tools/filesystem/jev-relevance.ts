/*
 * Jev semantic relevance filtering for find_file.
 *
 * When the agent passes a natural-language query to find_file, every
 * content match is judged by the Jev decision model (OpenRouter Decisions
 * API, ~typesafe/jev-latest): "is this excerpt materially related to the
 * search goal?". Only matches whose relevance probability clears the
 * threshold are returned, each with its score.
 *
 * Batched like extensions-examples/filesystem/semantic_search.ts: up to
 * MAX_JEV_QUESTIONS excerpts per API call, keyed by "candidate_N".
 *
 * If the Jev model is not configured or the call fails, the caller keeps
 * the unfiltered matches (same fallback philosophy as doc-section-finder).
 */
import { getJevDecision } from "../decision/Jev_model";

export const MAX_JEV_QUESTIONS = 32;
export const DEFAULT_RELEVANCE_THRESHOLD = 0.6;
export const MAX_QUERY_CHARS = 4_000;

export type JevCandidate = {
  id: string;
  file_name: string;
  path: string;
  text: string;
  line_start: number;
  line_end: number;
};

export type JevJudgedCandidate = JevCandidate & {
  relevance: number;
};

type JevAnswer = {
  noul?: unknown;
  probabilities?: Record<string, unknown>;
  value?: unknown;
  answer?: unknown;
};

type JevResponse = {
  answers?: Record<string, JevAnswer>;
};

/**
 * Extracts the yes/relevant probability from a Jev `noul` answer.
 */
export function probabilityOfRelevant(
  answer: JevAnswer | undefined,
): number {
  if (!answer || typeof answer !== "object") {
    return 0;
  }

  // Jev's `noul` answer is the yes/no probability.
  const noul = Number((answer as JevAnswer & { noul?: unknown }).noul);
  if (Number.isFinite(noul)) {
    return Math.max(0, Math.min(1, noul));
  }

  const probabilities = answer.probabilities;
  if (
    probabilities &&
    typeof probabilities === "object" &&
    !Array.isArray(probabilities)
  ) {
    for (const key of ["true", "yes", "relevant", "related"]) {
      const number = Number(probabilities[key]);
      if (Number.isFinite(number)) {
        return Math.max(0, Math.min(1, number));
      }
    }
  }

  const value = answer.value ?? answer.answer;
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  return 0;
}

async function judgeBatch(
  query: string,
  candidates: JevCandidate[],
): Promise<JevJudgedCandidate[]> {
  const questions = Object.fromEntries(
    candidates.map((candidate) => [
      candidate.id,
      {
        type: "noul" as const,
        instructions:
          "Decide whether this file excerpt is materially related to the search goal. " +
          "Ignore mere word overlap. Use true only when the text would help answer the goal.",
        criteria: {
          true: "The excerpt is relevant to the search goal.",
          false: "The excerpt is not relevant to the search goal.",
        },
      },
    ]),
  );

  const response = (await getJevDecision({
    state: {
      search_goal: query,
      candidates: candidates.map(({ id, ...candidate }) => ({
        id,
        ...candidate,
      })),
    },
    questions,
  })) as JevResponse;

  return candidates.map((candidate) => ({
    ...candidate,
    relevance: probabilityOfRelevant(response?.answers?.[candidate.id]),
  }));
}

/**
 * Judges candidates with Jev and keeps those at or above `threshold`.
 * Throws when the Jev model is not configured or the API call fails;
 * callers decide whether to fall back to unfiltered results.
 */
export async function filterByJevRelevance(
  query: string,
  candidates: JevCandidate[],
  threshold = DEFAULT_RELEVANCE_THRESHOLD,
  batchSize = MAX_JEV_QUESTIONS,
): Promise<JevJudgedCandidate[]> {
  const cleanQuery = query.trim();

  if (!cleanQuery) {
    throw new Error("A non-empty search query is required.");
  }

  if (cleanQuery.length > MAX_QUERY_CHARS) {
    throw new Error(
      `query must be at most ${MAX_QUERY_CHARS} characters.`,
    );
  }

  const clampedThreshold = Math.max(0, Math.min(1, threshold));
  const clampedBatch = Math.max(
    1,
    Math.min(MAX_JEV_QUESTIONS, Math.floor(batchSize) || MAX_JEV_QUESTIONS),
  );

  const judged: JevJudgedCandidate[] = [];

  for (let offset = 0; offset < candidates.length; offset += clampedBatch) {
    const batch = candidates.slice(offset, offset + clampedBatch);
    const results = await judgeBatch(cleanQuery, batch);
    judged.push(
      ...results.filter(
        (candidate) => candidate.relevance >= clampedThreshold,
      ),
    );
  }

  return judged;
}
