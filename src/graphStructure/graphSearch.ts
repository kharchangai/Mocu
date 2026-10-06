// src/graphStructure/graphSearch.ts
//
// Retrieval over the run graphs saved by graphStorage. Input is a free
// query (the agent's current question), output is ranked runs from the
// ACTIVE PROJECT database that look relevant to that query.
//
// Scoring (fail-open, same principle as cleanup/storage):
//   1. Vector path: embed the query once, cosine-compare it against each
//      run's stored `embedding`. Preferred when the embedding service is
//      available and at least one run has a vector.
//   2. Keyword path: token overlap against each run's `searchable` text.
//      Used alone when embedding fails, and as a small boost on top of
//      vector scores so lexically obvious runs are not invisible.
//
// Graph structure itself is not scored node-by-node: the searchable text
// (user message + final answer + tool summary) is the indexed projection
// of the graph. Callers who need the full nodes/edges can pass
// `includeGraph` (or use get_run_graph with a runId).

import { textSimilarity } from "../services/ai/tools/textSimilarity";
import type { AgentRunGraph } from "./graphMaker";
import {
  listRunGraphs,
  loadRunGraph,
  type RunGraphSearchable,
  type StoredRunGraphData,
} from "./graphStorage";

export const DEFAULT_GRAPH_SEARCH_LIMIT = 5;

/** Final score = vectorScore + KEYWORD_BOOST * keywordScore. */
const KEYWORD_BOOST = 0.25;

/** Capped so one long tool dump cannot drown the rest of the text. */
const KEYWORD_TEXT_LIMIT = 8000;

/** Minimum keyword score (0..1) to count as a hit without vectors. */
const KEYWORD_MIN_SCORE = 0.05;

export type GraphSearchMatch = {
  runId: string;
  agentKind: string;
  chatId?: string;
  savedAt: number;
  score: number;
  method: "vector" | "keyword" | "vector+keyword" | "none";
  searchable: RunGraphSearchable;
  graph?: AgentRunGraph;
};

export type GraphSearchOptions = {
  /** Max results returned (default 5). */
  limit?: number;
  /** Attach the full nodes/edges graph to each match. */
  includeGraph?: boolean;
};

export type GraphSearchResult = {
  query: string;
  matches: GraphSearchMatch[];
  /** How scores were produced; useful for debugging and tests. */
  scoring: "vector" | "keyword" | "vector+keyword" | "none";
  /** Set when the vector path was intended but failed. */
  vectorError?: string;
  totalGraphs: number;
};

const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return 0;
    }
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
};

const tokenize = (text: string): string[] => {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  return [...new Set(tokens)];
};

/**
 * Simple token overlap: share of the query's tokens found in the
 * candidate text. Handles Persian and Latin (unicode-aware split).
 */
export const keywordScore = (
  query: string,
  candidate: string,
): number => {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || !candidate.trim()) {
    return 0;
  }
  const haystack = candidate.slice(0, KEYWORD_TEXT_LIMIT).toLowerCase();
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
};

const searchableToText = (searchable: RunGraphSearchable): string =>
  [searchable.userMessage, searchable.finalAnswer, searchable.toolSummary]
    .filter(Boolean)
    .join("\n");

/**
 * One consistent result shape from a stored graph + its score.
 */
const toMatch = (
  data: StoredRunGraphData,
  score: number,
  method: GraphSearchMatch["method"],
  includeGraph: boolean,
): GraphSearchMatch => ({
  runId: data.graph.runId,
  agentKind: data.agentKind,
  ...(data.chatId !== undefined ? { chatId: data.chatId } : {}),
  savedAt: data.savedAt,
  score,
  method,
  searchable: data.searchable,
  ...(includeGraph ? { graph: data.graph } : {}),
});

/**
 * Searches every saved run graph of the project for relevance to
 * `query`. Never throws for embedding issues — falls back to keywords.
 */
export const searchRunGraphs = async (
  projectPath: string | undefined,
  query: string,
  options: GraphSearchOptions = {},
): Promise<GraphSearchResult> => {
  const trimmedQuery = query.trim();
  const limit = Math.max(1, options.limit ?? DEFAULT_GRAPH_SEARCH_LIMIT);
  const includeGraph = options.includeGraph === true;

  const graphs = await listRunGraphs(projectPath);
  const totalGraphs = graphs.length;

  if (!trimmedQuery || totalGraphs === 0) {
    return {
      query: trimmedQuery,
      matches: [],
      scoring: "none",
      totalGraphs,
    };
  }

  // Keyword scores always available (no external service involved).
  const keywordScores = graphs.map((data) =>
    keywordScore(trimmedQuery, searchableToText(data.searchable)),
  );

  // Vector path: only attempted when at least one run was embedded.
  const hasAnyEmbedding = graphs.some(
    (data) =>
      Array.isArray(data.embedding) &&
      data.embedding.length > 0 &&
      data.embedding.every((value) => Number.isFinite(value)),
  );

  let vectorScores: number[] | null = null;
  let vectorError: string | undefined;

  if (hasAnyEmbedding) {
    try {
      const queryEmbedding = await textSimilarity.embedText(trimmedQuery);
      vectorScores = graphs.map((data) =>
        data.embedding &&
        data.embedding.length > 0 &&
        data.embedding.length === queryEmbedding.length
          ? cosineSimilarity(queryEmbedding, data.embedding)
          : 0,
      );
    } catch (error) {
      vectorError = error instanceof Error ? error.message : String(error);
    }
  }

  const matches = graphs
    .map((data, index) => {
      const keyword = keywordScores[index] ?? 0;
      const vector = vectorScores ? Math.max(0, vectorScores[index] ?? 0) : 0;

      if (vectorScores) {
        const score = vector + KEYWORD_BOOST * keyword;
        const method: GraphSearchMatch["method"] =
          keyword >= KEYWORD_MIN_SCORE ? "vector+keyword" : "vector";
        return toMatch(data, score, method, includeGraph);
      }

      if (keyword >= KEYWORD_MIN_SCORE) {
        return toMatch(data, keyword, "keyword", includeGraph);
      }

      return toMatch(data, 0, "none", includeGraph);
    })
    .filter((match) => match.score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || second.savedAt - first.savedAt,
    )
    .slice(0, limit);

  const scoring: GraphSearchResult["scoring"] = vectorScores
    ? keywordScores.some((score) => score >= KEYWORD_MIN_SCORE)
      ? "vector+keyword"
      : "vector"
    : keywordScores.some((score) => score >= KEYWORD_MIN_SCORE)
      ? "keyword"
      : "none";

  return {
    query: trimmedQuery,
    matches,
    scoring,
    ...(vectorError !== undefined ? { vectorError } : {}),
    totalGraphs,
  };
};

/**
 * Loads one run graph by id (shared import for tools/tests).
 */
export const getRunGraphById = async (
  projectPath: string | undefined,
  runId: string,
): Promise<StoredRunGraphData | null> => {
  return loadRunGraph(projectPath, runId);
};