import { search, type SearchResult } from "./regex_search.ts";
const MAX_JEV_QUESTIONS = 32;
const DEFAULT_THRESHOLD = 0.6;
const MAX_QUERY_CHARS = 4_000;

export type SemanticSearchInput = {
  folder: string;
  query: string;
  patterns: string[];
  extensions: string[];
  threshold?: number;
  batch_size?: number;
};

export type FilteredSearchResult = SearchResult & {
  id: string;
  relevance: number;
};

type JevAnswer = {
  probabilities?: Record<string, unknown>;
  value?: unknown;
  answer?: unknown;
};

export type DecisionClient = {
  decision: {
    ask(params: {
      state: unknown;
      questions: Record<string, {
        type: "noul";
        instructions: string;
        criteria: { true: string; false: string };
      }>;
    }): Promise<unknown>;
  };
};
type JevResponse = {
  answers?: Record<string, JevAnswer>;
};

function validateInput(input: unknown): SemanticSearchInput {
  if (!input || typeof input !== "object") throw new Error("input must be an object");
  const value = input as Record<string, unknown>;
  if (typeof value.folder !== "string" || !value.folder.trim()) throw new Error("folder is required");
  if (typeof value.query !== "string" || !value.query.trim() || value.query.length > MAX_QUERY_CHARS) {
    throw new Error(`query must be a non-empty string up to ${MAX_QUERY_CHARS} characters`);
  }
  if (!Array.isArray(value.patterns) || value.patterns.length === 0 || value.patterns.some((p) => typeof p !== "string")) {
    throw new Error("patterns must be a non-empty string array");
  }
  if (!Array.isArray(value.extensions) || value.extensions.length === 0 || value.extensions.some((e) => typeof e !== "string")) {
    throw new Error("extensions must be a non-empty string array");
  }
  const threshold = value.threshold === undefined ? DEFAULT_THRESHOLD : Number(value.threshold);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("threshold must be between 0 and 1");
  const batchSize = value.batch_size === undefined ? MAX_JEV_QUESTIONS : Number(value.batch_size);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_JEV_QUESTIONS) {
    throw new Error(`batch_size must be an integer between 1 and ${MAX_JEV_QUESTIONS}`);
  }
  return {
    folder: value.folder,
    query: value.query.trim(),
    patterns: value.patterns,
    extensions: value.extensions,
    threshold,
    batch_size: batchSize,
  } as SemanticSearchInput;
}

function probabilityOfTrue(answer: JevAnswer | undefined): number {
  if (!answer || typeof answer !== "object") return 0;

  // Jev's `noul` answer is the yes/relevant probability.
  const noul = Number((answer as JevAnswer & { noul?: unknown }).noul);
  if (Number.isFinite(noul)) return Math.max(0, Math.min(1, noul));

  const probabilities = answer.probabilities;
  if (probabilities && typeof probabilities === "object" && !Array.isArray(probabilities)) {
    for (const key of ["true", "yes", "relevant", "related"]) {
      const number = Number(probabilities[key]);
      if (Number.isFinite(number)) return Math.max(0, Math.min(1, number));
    }
  }

  const value = answer.value ?? answer.answer;
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0;
}
async function evaluateBatch(
  extension: DecisionClient,
  query: string,
  candidates: Array<SearchResult & { id: string }>,
): Promise<FilteredSearchResult[]> {
  const questions = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
    type: "noul" as const,
    instructions: "Decide whether this candidate is materially related to the agent's search goal. Ignore mere word overlap. Use true only when the text would help answer the goal.",
    criteria: {
      true: "The candidate text is relevant to the search goal.",
      false: "The candidate text is not relevant to the search goal.",
    },
  }]));

  const response = await extension.decision.ask({
    state: {
      search_goal: query,
      candidates: candidates.map(({ id, ...candidate }) => ({ id, ...candidate })),
    },
    questions,
  }) as JevResponse;

  return candidates.map((candidate) => {
    const relevance = probabilityOfTrue(response?.answers?.[candidate.id]);
    return { ...candidate, relevance };
  });
}

export async function semanticSearch(
  extension: DecisionClient,
  rawInput: unknown,
): Promise<FilteredSearchResult[]> {
  const input = validateInput(rawInput);
  const found = search(input.folder, input.patterns, input.extensions);
  const candidates = found.map((candidate, index) => ({ ...candidate, id: `candidate_${index + 1}` }));
  const filtered: FilteredSearchResult[] = [];
  const batchSize = input.batch_size ?? MAX_JEV_QUESTIONS;

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const judged = await evaluateBatch(extension, input.query, batch);
    filtered.push(...judged.filter((candidate) => candidate.relevance >= (input.threshold ?? DEFAULT_THRESHOLD)));
  }

  return filtered;
}

