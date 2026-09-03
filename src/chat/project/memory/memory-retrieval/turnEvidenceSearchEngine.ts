// memory-retrieval/turnEvidenceSearchEngine.ts

import Database from "@tauri-apps/plugin-sql";

import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";
import type {
  MemoryWindow,
  WindowEntity,
} from "../window/types";
import {
  clamp,
  normalizeText,
} from "../window/helpers";
import {
  buildMemoryQuery,
  type BuildMemoryQueryInput,
  type MemoryQueryEntity,
  type MemoryRetrievalQuery,
} from "./memoryQuery";
import {
  findLastEpisode,
  searchEpisodes,
  type EpisodeSearchResult,
} from "./episodeSearchEngine";
import type {
  MemoryEpisode,
} from "../episode/types";
import {
  searchWindowsInEpisode,
  type WindowSearchResult,
} from "./windowSearchEngine";
import { readLastTurn } from "./continuityAnalyzer";

/* -------------------------------------------------------------------------- */
/* Public Types                                                               */
/* -------------------------------------------------------------------------- */

export interface TurnEvidenceSearchOptions {
  /**
   * Maximum number of Turns selected by relevance before related
   * Turns are added and token-budget refinement is applied.
   */
  topTurnCount?: number;

  /**
   * Maximum token budget for the final memory context.
   */
  maxTokens?: number;

  /**
   * Optional real tokenizer.
   *
   * It is strongly recommended to provide the tokenizer belonging to
   * the final language model.
   */
  countTokens?: (
    text: string,
  ) => number | Promise<number>;
}

export interface TurnEvidenceScore {
  semanticQuerySimilarity: number;
  userMessageSimilarity: number;
  keywordScore: number;
  entityScore: number;
  finalScore: number;
}

/**
 * Relation assessment of one Turn towards its neighboring Turns
 * inside the Window.
 *
 * The stored Turn records do not contain a dedicated relation field,
 * therefore the relation is derived from the stored data:
 * adjacent-turn embedding similarity plus shared keywords and
 * entities.
 */
export interface TurnRelationInfo {
  /** true when this Turn relates to the previous Turn. */
  relatedToPrevious: boolean;

  /** true when this Turn relates to the next Turn. */
  relatedToNext: boolean;

  /**
   * Adjacency relation score towards the previous Turn
   * (0 when no previous Turn exists).
   */
  previousRelationScore: number;

  /**
   * Adjacency relation score towards the next Turn
   * (0 when no next Turn exists).
   */
  nextRelationScore: number;
}

export type TurnEvidenceMode =
  | "whole-turn"
  | "selected-spans";

/**
 * Why a Turn is part of the response.
 *
 * - "search-result": the Turn was selected by its own relevance.
 * - "related-context": the Turn is a related neighbor of a selected
 *   Turn and is included so the agent receives complete memory.
 */
export type TurnInclusionReason =
  | "search-result"
  | "related-context";

export interface SelectedSpanEvidence {
  spanIndex: number;
  tag: string;
  text: string;
  tokenCount: number;
  score: TurnEvidenceScore;
}

export interface SelectedTurnEvidence {
  turnIndex: number;
  mode: TurnEvidenceMode;
  includedAs: TurnInclusionReason;

  /**
   * Complete Turn text when mode is whole-turn.
   * Selected complete Span texts when mode is selected-spans.
   */
  text: string;

  tokenCount: number;
  score: TurnEvidenceScore;
  spans: SelectedSpanEvidence[];

  /**
   * Relation of the Turn to its neighboring Turns.
   */
  relation: TurnRelationInfo;
}

export interface TurnEvidenceSearchResult {
  episode: EpisodeSearchResult;
  window: WindowSearchResult;

  /**
   * Selected Turns and their related context Turns in chronological
   * Window order, so the final model can follow the original
   * conversation.
   */
  turns: SelectedTurnEvidence[];

  /**
   * Ready-to-use memory context.
   */
  contextText: string;

  estimatedTokens: number;
  maxTokens: number;

  /**
   * true when complete Turns exceeded the budget and Span selection
   * was used.
   */
  wasRefinedToSpans: boolean;
}

/* -------------------------------------------------------------------------- */
/* Internal Types                                                             */
/* -------------------------------------------------------------------------- */

interface RecordRow {
  record_key: string;
  payload: string;
}

interface PreparedQuery {
  semanticQueryEmbedding: number[];
  userMessageEmbedding: number[];
  keywords: string[];
  entities: NormalizedEntity[];
}

interface NormalizedEntity {
  normalizedName: string;
  type: string;
}

interface SearchableSpan {
  spanIndex: number;
  tag: string;
  text: string;
  embedding: number[] | null;
}

interface SearchableTurn {
  turnIndex: number;
  text: string;
  keywords: string[];
  entities: WindowEntity[];
  embedding: number[] | null;
  storedSpans: SearchableSpan[];
}

interface ScoredTurn extends SearchableTurn {
  score: TurnEvidenceScore;
  relation: TurnRelationInfo;

  /** true when selected by relevance. */
  isTopTurn: boolean;
}

interface ScoredSpan {
  turnIndex: number;
  spanIndex: number;
  tag: string;
  text: string;
  score: TurnEvidenceScore;
  tokenCount: number;
  selectionScore: number;
}

interface ScoreComponent {
  value: number;
  weight: number;
  active: boolean;
}

type TokenCounter = (
  text: string,
) => Promise<number>;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_TOP_TURN_COUNT = 3;
const DEFAULT_MAX_TOKENS = 2000;

/**
 * Minimum score for a Turn to be selected as a search result.
 * Related-context Turns bypass this threshold because they are
 * included for completeness, not relevance.
 */
const MINIMUM_TURN_SCORE = 0.55;

/**
 * Minimum adjacency score for two neighboring Turns to be treated as
 * related.
 */
const TURN_RELATION_THRESHOLD = 0.55;

const SCORE_WEIGHTS = {
  semanticQuery: 0.5,
  userMessage: 0.2,
  keywords: 0.15,
  entities: 0.15,
} as const;

const RELATION_WEIGHTS = {
  adjacentEmbedding: 0.7,
  sharedKeywords: 0.3,
} as const;

/**
 * Turn score also influences Span selection.
 *
 * This prevents a moderately relevant Span from a weak Turn from
 * replacing strong evidence belonging to a highly relevant Turn.
 */
const SPAN_SELECTION_WEIGHTS = {
  span: 0.8,
  parentTurn: 0.2,
} as const;

/* -------------------------------------------------------------------------- */
/* Main Public API                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Executes the complete hierarchical retrieval process:
 *
 * 1. Builds MemoryRetrievalQuery once.
 * 2. Finds the best Episode.
 * 3. Finds the best Window inside the Episode.
 * 4. Finds the most relevant Turns inside the Window.
 * 5. Adds neighboring Turns that are related to a selected Turn
 *    (relation to the previous or next Turn), so the agent receives
 *    complete memory context.
 * 6. Returns complete Turns when they fit within the token budget.
 * 7. Otherwise selects the related Spans of each Turn without cutting
 *    text.
 */
export async function findBestTurnEvidence(
  input: BuildMemoryQueryInput,
  databasePath: string,
  options: TurnEvidenceSearchOptions = {},
): Promise<TurnEvidenceSearchResult | null> {
  const userMessage =
    validateBuildMemoryQueryInput(input);

  const normalizedDatabasePath =
    normalizeDatabasePath(databasePath);

  const query = await buildMemoryQuery(input);

  const episode = await searchEpisodes(
    query,
    userMessage,
    normalizedDatabasePath,
  );

  if (!episode) {
    return null;
  }

  const window = await searchWindowsInEpisode(
    query,
    userMessage,
    episode,
    normalizedDatabasePath,
  );

  if (!window) {
    return null;
  }

  return searchTurnsInWindow(
    query,
    userMessage,
    window,
    normalizedDatabasePath,
    options,
  );
}

/**
 * Returns the last Turn of the last Window of the last Episode in
 * the SQLite database as Turn evidence, without running the search
 * pipeline.
 *
 * Used when the continuity analysis selects "PREVIOUS_TURN": the
 * current message depends only on the previous turn, so long-term
 * memory search is unnecessary and the latest stored turn is
 * returned directly.
 *
 * Falls back to the most recent 'turn' record when no Episode or
 * Window structure exists yet (early sessions).
 *
 * Returns null when the database contains no turns at all.
 *
 * @param databasePath Location of the SQLite database file.
 * @param options Optional token budget options (maxTokens and
 *                countTokens are respected).
 */
export async function findLastTurnEvidence(
  databasePath: string,
  options: TurnEvidenceSearchOptions = {},
): Promise<TurnEvidenceSearchResult | null> {
  const maxTokens = normalizePositiveInteger(
    options.maxTokens,
    DEFAULT_MAX_TOKENS,
    "maxTokens",
  );

  const countTokens = createTokenCounter(
    options.countTokens,
  );

  /*
   * 1. Last Episode -> last Window -> last Turn.
   */
  const episode = await findLastEpisode(
    databasePath,
  );

  if (episode) {
    const lastTurnEvidence =
      await buildLastTurnFromEpisode(
        episode,
        databasePath,
        maxTokens,
        countTokens,
      );

    if (lastTurnEvidence) {
      return lastTurnEvidence;
    }
  }

  /*
   * 2. Fallback: most recent 'turn' record (used when no Episode
   *    or Window structure exists yet).
   */
  return buildLastTurnFromTurnRecord(
    databasePath,
    maxTokens,
    countTokens,
  );
}

/**
 * Builds the last-turn evidence from the last Window of the given
 * Episode. Returns null when the Episode has no Window with Turns.
 */
async function buildLastTurnFromEpisode(
  episode: MemoryEpisode,
  databasePath: string,
  maxTokens: number,
  countTokens: TokenCounter,
): Promise<TurnEvidenceSearchResult | null> {
  const windowIds = Array.isArray(
    episode.windowIds,
  )
    ? episode.windowIds
    : [];

  const lastWindowId =
    windowIds[windowIds.length - 1];

  if (!lastWindowId) {
    return null;
  }

  const normalizedPath = normalizeDatabasePath(
    databasePath,
  );

  const window = await loadWindow(
    lastWindowId,
    normalizedPath,
  );

  if (!window) {
    return null;
  }

  const turns = Array.isArray(window.turns)
    ? window.turns
    : [];

  const lastTurn = turns[turns.length - 1];

  if (!lastTurn) {
    return null;
  }

  const userMessage =
    typeof lastTurn.userMessage === "string"
      ? lastTurn.userMessage.trim()
      : "";

  const agentResponse =
    typeof lastTurn.agentResponse === "string"
      ? lastTurn.agentResponse.trim()
      : "";

  /* Same Turn text format as extractSearchableTurns. */
  const text = [
    userMessage ? `User:\n${userMessage}` : "",
    agentResponse
      ? `Assistant:\n${agentResponse}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!text) {
    return null;
  }

  const tokenCount = await countTokens(text);

  const episodeResult: EpisodeSearchResult = {
    episodeId: episode.id,
    sessionId: episode.sessionId,
    subject:
      typeof episode.indexes?.subject === "string"
        ? episode.indexes.subject
        : "",
    keywords: Array.isArray(
      episode.indexes?.keywords,
    )
      ? episode.indexes.keywords
      : [],
    entities: Array.isArray(
      episode.indexes?.entities,
    )
      ? episode.indexes.entities
      : [],
    score: createZeroScore(),
  };

  const subjects = Array.isArray(
    window.indexes?.subjects,
  )
    ? window.indexes.subjects
    : [];

  const windowEntities =
    Array.isArray(lastTurn.indexes?.entities)
      ? lastTurn.indexes.entities
      : [];

  const windowResult: WindowSearchResult = {
    windowId: window.id,
    episodeId: episodeResult.episodeId,
    sessionId:
      typeof window.sessionId === "string"
        ? window.sessionId
        : episodeResult.sessionId,
    subject:
      subjects.length > 0
        ? subjects[subjects.length - 1]
        : "",
    keywords: Array.isArray(
      window.indexes?.keywords,
    )
      ? window.indexes.keywords
      : [],
    entities: windowEntities,
    score: createZeroScore(),
    episode: episodeResult,
  };

  const turn: SelectedTurnEvidence = {
    turnIndex: turns.length - 1,
    mode: "whole-turn",
    includedAs: "search-result",
    text,
    tokenCount,
    score: createZeroScore(),
    spans: [],
    relation: createEmptyRelation(),
  };

  return {
    episode: episodeResult,
    window: windowResult,
    turns: [turn],
    contextText: text,
    estimatedTokens: tokenCount,
    maxTokens,
    wasRefinedToSpans: false,
  };
}

/**
 * Builds the last-turn evidence from the most recent 'turn' record.
 * Fallback for databases without Episode/Window structure yet.
 */
async function buildLastTurnFromTurnRecord(
  databasePath: string,
  maxTokens: number,
  countTokens: TokenCounter,
): Promise<TurnEvidenceSearchResult | null> {
  const lastTurn = await readLastTurn(databasePath);

  if (!lastTurn) {
    return null;
  }

  /* Same Turn text format as extractSearchableTurns. */
  const text = [
    lastTurn.userMessage
      ? `User:\n${lastTurn.userMessage}`
      : "",
    lastTurn.agentResponse
      ? `Assistant:\n${lastTurn.agentResponse}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  const tokenCount = await countTokens(text);

  const turn: SelectedTurnEvidence = {
    turnIndex: 0,
    mode: "whole-turn",
    includedAs: "search-result",
    text,
    tokenCount,
    score: createZeroScore(),
    spans: [],
    relation: createEmptyRelation(),
  };

  const episode: EpisodeSearchResult = {
    episodeId: "last-turn",
    sessionId: "",
    subject: "Last conversation turn",
    keywords: [],
    entities: [],
    score: createZeroScore(),
  };

  const window: WindowSearchResult = {
    windowId: "last-turn",
    episodeId: episode.episodeId,
    sessionId: "",
    subject: episode.subject,
    keywords: [],
    entities: [],
    score: createZeroScore(),
    episode,
  };

  return {
    episode,
    window,
    turns: [turn],
    contextText: text,
    estimatedTokens: tokenCount,
    maxTokens,
    wasRefinedToSpans: false,
  };
}

/**
 * Finds relevant Turn evidence when the best Window has already been
 * found and the original MemoryRetrievalQuery is available.
 *
 * Use this function to avoid rebuilding the memory query.
 */
export async function searchTurnsInWindow(
  query: MemoryRetrievalQuery,
  userMessage: string,
  windowResult: WindowSearchResult,
  databasePath: string,
  options: TurnEvidenceSearchOptions = {},
): Promise<TurnEvidenceSearchResult | null> {
  validateMemoryQuery(query);

  const normalizedUserMessage =
    validateUserMessage(userMessage);

  validateWindowSearchResult(windowResult);

  const normalizedDatabasePath =
    normalizeDatabasePath(databasePath);

  const topTurnCount = normalizePositiveInteger(
    options.topTurnCount,
    DEFAULT_TOP_TURN_COUNT,
    "topTurnCount",
  );

  const maxTokens = normalizePositiveInteger(
    options.maxTokens,
    DEFAULT_MAX_TOKENS,
    "maxTokens",
  );

  const countTokens = createTokenCounter(
    options.countTokens,
  );

  const preparedQuery = await prepareSearchQuery(
    query,
    normalizedUserMessage,
  );

  const window = await loadWindow(
    windowResult.windowId,
    normalizedDatabasePath,
  );

  if (!window) {
    return null;
  }

  const searchableTurns =
    extractSearchableTurns(window);

  if (searchableTurns.length === 0) {
    return null;
  }

  /*
   * Derive the before/after relation of every Turn from the stored
   * data (adjacent embedding similarity + shared keywords).
   */
  const relations = await computeTurnRelations(
    searchableTurns,
  );

  const scoredTurns = await scoreTurns(
    preparedQuery,
    searchableTurns,
    relations,
  );

  if (scoredTurns.length === 0) {
    return null;
  }

  /*
   * Select the most relevant Turns and mark their related
   * neighbors for inclusion.
   */
  const evidenceTurns =
    selectEvidenceTurns(
      scoredTurns,
      topTurnCount,
    );

  if (evidenceTurns.length === 0) {
    return null;
  }

  const completeTurnsResult =
    await buildCompleteTurnsResult(
      evidenceTurns,
      countTokens,
      maxTokens,
    );

  if (completeTurnsResult) {
    return {
      episode: windowResult.episode,
      window: windowResult,
      turns: completeTurnsResult.turns,
      contextText:
        completeTurnsResult.contextText,
      estimatedTokens:
        completeTurnsResult.estimatedTokens,
      maxTokens,
      wasRefinedToSpans: false,
    };
  }

  /*
   * The Turns are too long for the budget: select the related
   * Spans of every evidence Turn instead.
   */
  const refinedResult =
    await buildSpanRefinedResult(
      preparedQuery,
      evidenceTurns,
      countTokens,
      maxTokens,
    );

  if (
    refinedResult.turns.length === 0 ||
    !refinedResult.contextText
  ) {
    return null;
  }

  return {
    episode: windowResult.episode,
    window: windowResult,
    turns: refinedResult.turns,
    contextText: refinedResult.contextText,
    estimatedTokens:
      refinedResult.estimatedTokens,
    maxTokens,
    wasRefinedToSpans: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Turn Selection + Relation Expansion                                        */
/* -------------------------------------------------------------------------- */

/**
 * Selects the top Turns by score and adds related neighboring Turns.
 *
 * A neighbor is added when the selected Turn relates to it. This
 * guarantees complete memory: a correction, follow-up question, or
 * continuation is never returned without the Turn it belongs to.
 */
function selectEvidenceTurns(
  scoredTurns: ScoredTurn[],
  topTurnCount: number,
): ScoredTurn[] {
  const eligibleTurns = scoredTurns.filter(
    (turn) =>
      turn.score.finalScore >= MINIMUM_TURN_SCORE,
  );

  if (eligibleTurns.length === 0) {
    return [];
  }

  const topTurns = eligibleTurns
    .sort(compareTurnsByScore)
    .slice(0, topTurnCount);

  const turnByIndex = new Map(
    scoredTurns.map(
      (turn) => [turn.turnIndex, turn] as const,
    ),
  );

  const evidenceTurns = new Map<number, ScoredTurn>();

  for (const turn of topTurns) {
    evidenceTurns.set(turn.turnIndex, {
      ...turn,
      isTopTurn: true,
    });

    /*
     * Previous neighbor: included when this Turn relates to it
     * (the previous Turn provides the context of this Turn).
     */
    if (
      turn.relation.relatedToPrevious
    ) {
      const previousTurn = turnByIndex.get(
        turn.turnIndex - 1,
      );

      if (
        previousTurn &&
        !evidenceTurns.has(previousTurn.turnIndex)
      ) {
        evidenceTurns.set(
          previousTurn.turnIndex,
          {
            ...previousTurn,
            isTopTurn: false,
          },
        );
      }
    }

    /*
     * Next neighbor: included when this Turn relates to it
     * (for example the result or completion of this Turn).
     */
    if (turn.relation.relatedToNext) {
      const nextTurn = turnByIndex.get(
        turn.turnIndex + 1,
      );

      if (
        nextTurn &&
        !evidenceTurns.has(nextTurn.turnIndex)
      ) {
        evidenceTurns.set(
          nextTurn.turnIndex,
          {
            ...nextTurn,
            isTopTurn: false,
          },
        );
      }
    }
  }

  return [...evidenceTurns.values()];
}

/**
 * Derives the before/after relation of every Turn from the stored
 * data.
 *
 * Two neighboring Turns are related when their adjacency score
 * reaches the relation threshold. The adjacency score combines:
 *
 * - the embedding similarity of the two Turns (0.7)
 * - their shared keyword coverage (0.3)
 *
 * Embeddings are compared only when both Turns provide a usable
 * stored embedding; otherwise only keywords are used.
 */
async function computeTurnRelations(
  turns: SearchableTurn[],
): Promise<Map<number, TurnRelationInfo>> {
  const relations =
    new Map<number, TurnRelationInfo>();

  for (
    let index = 0;
    index < turns.length;
    index += 1
  ) {
    const turn = turns[index];

    const previousTurn =
      index > 0 ? turns[index - 1] : null;

    const nextTurn =
      index < turns.length - 1
        ? turns[index + 1]
        : null;

    const previousRelationScore =
      previousTurn
        ? await calculateAdjacencyScore(
            turn,
            previousTurn,
          )
        : 0;

    const nextRelationScore = nextTurn
      ? await calculateAdjacencyScore(
          turn,
          nextTurn,
        )
      : 0;

    relations.set(turn.turnIndex, {
      relatedToPrevious:
        previousRelationScore >=
        TURN_RELATION_THRESHOLD,
      relatedToNext:
        nextRelationScore >=
        TURN_RELATION_THRESHOLD,
      previousRelationScore,
      nextRelationScore,
    });
  }

  return relations;
}

/**
 * Adjacency relation score of two neighboring Turns.
 */
async function calculateAdjacencyScore(
  first: SearchableTurn,
  second: SearchableTurn,
): Promise<number> {
  const keywordScore =
    calculateSharedKeywordScore(
      first.keywords,
      second.keywords,
    );

  let embeddingScore: number | null = null;

  if (
    first.embedding &&
    second.embedding &&
    first.embedding.length ===
      second.embedding.length
  ) {
    embeddingScore =
      normalizeCosineSimilarity(
        textSimilarity.compareEmbeddingToEmbedding(
          first.embedding,
          second.embedding,
        ),
      );
  }

  if (embeddingScore === null) {
    return keywordScore;
  }

  return clamp(
    embeddingScore *
      RELATION_WEIGHTS.adjacentEmbedding +
      keywordScore *
      RELATION_WEIGHTS.sharedKeywords,
    0,
    1,
  );
}

/**
 * Bidirectional keyword coverage of two Turns.
 *
 * 1.0 means every keyword of both Turns is shared.
 */
function calculateSharedKeywordScore(
  firstKeywords: string[],
  secondKeywords: string[],
): number {
  if (
    firstKeywords.length === 0 ||
    secondKeywords.length === 0
  ) {
    return 0;
  }

  const firstSet = new Set(firstKeywords);
  const secondSet = new Set(secondKeywords);

  let shared = 0;

  for (const keyword of firstKeywords) {
    if (secondSet.has(keyword)) {
      shared += 1;
      continue;
    }

    const partialMatch = [
      ...secondSet,
    ].some(
      (otherKeyword) =>
        otherKeyword.includes(keyword) ||
        keyword.includes(otherKeyword),
    );

    if (partialMatch) {
      shared += 0.7;
    }
  }

  const firstCoverage =
    shared / firstKeywords.length;

  let sharedFromSecond = 0;

  for (const keyword of secondKeywords) {
    if (firstSet.has(keyword)) {
      sharedFromSecond += 1;
      continue;
    }

    const partialMatch = [
      ...firstSet,
    ].some(
      (otherKeyword) =>
        otherKeyword.includes(keyword) ||
        keyword.includes(otherKeyword),
    );

    if (partialMatch) {
      sharedFromSecond += 0.7;
    }
  }

  const secondCoverage =
    sharedFromSecond / secondKeywords.length;

  return clamp(
    (firstCoverage + secondCoverage) / 2,
    0,
    1,
  );
}

/* -------------------------------------------------------------------------- */
/* Complete-Turn Selection                                                    */
/* -------------------------------------------------------------------------- */

async function buildCompleteTurnsResult(
  evidenceTurns: ScoredTurn[],
  countTokens: TokenCounter,
  maxTokens: number,
): Promise<{
  turns: SelectedTurnEvidence[];
  contextText: string;
  estimatedTokens: number;
} | null> {
  const chronologicalTurns = [
    ...evidenceTurns,
  ].sort(compareTurnsChronologically);

  const selectedTurns: SelectedTurnEvidence[] =
    chronologicalTurns.map((turn) => ({
      turnIndex: turn.turnIndex,
      mode: "whole-turn",
      includedAs: turn.isTopTurn
        ? "search-result"
        : "related-context",
      text: turn.text,
      tokenCount: 0,
      score: turn.score,
      spans: [],
      relation: turn.relation,
    }));

  for (const turn of selectedTurns) {
    turn.tokenCount = await countTokens(
      turn.text,
    );
  }

  const contextText =
    buildContextText(selectedTurns);

  const estimatedTokens =
    await countTokens(contextText);

  if (estimatedTokens > maxTokens) {
    return null;
  }

  return {
    turns: selectedTurns,
    contextText,
    estimatedTokens,
  };
}

/* -------------------------------------------------------------------------- */
/* Span Refinement                                                            */
/* -------------------------------------------------------------------------- */

async function buildSpanRefinedResult(
  query: PreparedQuery,
  evidenceTurns: ScoredTurn[],
  countTokens: TokenCounter,
  maxTokens: number,
): Promise<{
  turns: SelectedTurnEvidence[];
  contextText: string;
  estimatedTokens: number;
}> {
  const scoredSpansByTurn =
    new Map<number, ScoredSpan[]>();

  for (const turn of evidenceTurns) {
    const spans =
      turn.storedSpans.length > 0
        ? turn.storedSpans
        : createSafeFallbackSpans(
            turn.text,
          );

    const scoredSpans: ScoredSpan[] = [];

    for (const span of spans) {
      const score = await scoreSpan(
        query,
        span,
      );

      const tokenCount =
        await countTokens(span.text);

      if (tokenCount <= 0) {
        continue;
      }

      /*
       * A single atomic unit larger than the complete budget cannot
       * be added without either exceeding the budget or cutting it.
       * It is skipped to preserve evidence integrity.
       */
      if (tokenCount > maxTokens) {
        continue;
      }

      /*
       * Related-context Turns contribute their Spans with the
       * relation score of the pair instead of their own weaker
       * query score, so the context of a strong Turn is not lost.
       */
      const spanRelevance =
        turn.isTopTurn
          ? score.finalScore
          : Math.max(
              score.finalScore,
              turn.relation
                .relatedToPrevious
                ? turn.relation
                    .previousRelationScore
                : 0,
              turn.relation.relatedToNext
                ? turn.relation
                    .nextRelationScore
                : 0,
            );

      const selectionScore = clamp(
        spanRelevance *
          SPAN_SELECTION_WEIGHTS.span +
          turn.score.finalScore *
            SPAN_SELECTION_WEIGHTS.parentTurn,
        0,
        1,
      );

      scoredSpans.push({
        turnIndex: turn.turnIndex,
        spanIndex: span.spanIndex,
        tag: span.tag,
        text: span.text,
        score,
        tokenCount,
        selectionScore,
      });
    }

    scoredSpans.sort(
      compareSpanCandidatesByScore,
    );

    scoredSpansByTurn.set(
      turn.turnIndex,
      scoredSpans,
    );
  }

  const selectedCandidates: ScoredSpan[] = [];

  /*
   * First pass:
   *
   * Try to keep at least one strong atomic Span from every evidence
   * Turn. This preserves the meaning of the selected Turns (and their
   * related context) while still obeying the budget.
   */
  const turnsByScore = [...evidenceTurns]
    .filter((turn) => turn.isTopTurn)
    .sort(compareTurnsByScore);

  for (const turn of turnsByScore) {
    const candidates =
      scoredSpansByTurn.get(
        turn.turnIndex,
      ) ?? [];

    for (const candidate of candidates) {
      const trial = [
        ...selectedCandidates,
        candidate,
      ];

      if (
        await candidatesFitBudget(
          trial,
          evidenceTurns,
          countTokens,
          maxTokens,
        )
      ) {
        selectedCandidates.push(candidate);
        break;
      }
    }
  }

  /*
   * Second pass:
   *
   * Fill the remaining budget with the strongest unselected Spans
   * from all evidence Turns.
   */
  const remainingCandidates = [
    ...scoredSpansByTurn.values(),
  ]
    .flat()
    .filter(
      (candidate) =>
        !containsSpanCandidate(
          selectedCandidates,
          candidate,
        ),
    )
    .sort(compareSpanCandidatesByScore);

  for (const candidate of remainingCandidates) {
    const trial = [
      ...selectedCandidates,
      candidate,
    ];

    if (
      await candidatesFitBudget(
        trial,
        evidenceTurns,
        countTokens,
        maxTokens,
      )
    ) {
      selectedCandidates.push(candidate);
    }
  }

  const selectedTurns =
    buildSelectedTurnsFromSpans(
      evidenceTurns,
      selectedCandidates,
    );

  const contextText =
    buildContextText(selectedTurns);

  const estimatedTokens =
    await countTokens(contextText);

  return {
    turns: selectedTurns,
    contextText,
    estimatedTokens,
  };
}

async function candidatesFitBudget(
  candidates: ScoredSpan[],
  turns: ScoredTurn[],
  countTokens: TokenCounter,
  maxTokens: number,
): Promise<boolean> {
  const selectedTurns =
    buildSelectedTurnsFromSpans(
      turns,
      candidates,
    );

  const contextText =
    buildContextText(selectedTurns);

  const tokenCount =
    await countTokens(contextText);

  return tokenCount <= maxTokens;
}

function buildSelectedTurnsFromSpans(
  turns: ScoredTurn[],
  candidates: ScoredSpan[],
): SelectedTurnEvidence[] {
  const turnsByIndex = new Map(
    turns.map(
      (turn) => [turn.turnIndex, turn] as const,
    ),
  );

  const candidatesByTurn =
    new Map<number, ScoredSpan[]>();

  for (const candidate of candidates) {
    const existing =
      candidatesByTurn.get(
        candidate.turnIndex,
      ) ?? [];

    existing.push(candidate);

    candidatesByTurn.set(
      candidate.turnIndex,
      existing,
    );
  }

  const selectedTurns: SelectedTurnEvidence[] =
    [];

  const chronologicalTurnIndexes = [
    ...candidatesByTurn.keys(),
  ].sort(
    (first, second) => first - second,
  );

  for (
    const turnIndex of
    chronologicalTurnIndexes
  ) {
    const sourceTurn =
      turnsByIndex.get(turnIndex);

    if (!sourceTurn) {
      continue;
    }

    const selectedSpans = [
      ...(candidatesByTurn.get(turnIndex) ??
        []),
    ].sort(
      (first, second) =>
        first.spanIndex - second.spanIndex,
    );

    if (selectedSpans.length === 0) {
      continue;
    }

    const spanEvidence:
      SelectedSpanEvidence[] =
      selectedSpans.map((span) => ({
        spanIndex: span.spanIndex,
        tag: span.tag,
        text: span.text,
        tokenCount: span.tokenCount,
        score: span.score,
      }));

    selectedTurns.push({
      turnIndex,
      mode: "selected-spans",
      includedAs: sourceTurn.isTopTurn
        ? "search-result"
        : "related-context",
      text: spanEvidence
        .map((span) => span.text)
        .join("\n\n"),
      tokenCount: spanEvidence.reduce(
        (sum, span) =>
          sum + span.tokenCount,
        0,
      ),
      score: sourceTurn.score,
      spans: spanEvidence,
      relation: sourceTurn.relation,
    });
  }

  return selectedTurns;
}

/* -------------------------------------------------------------------------- */
/* Turn Scoring                                                               */
/* -------------------------------------------------------------------------- */

async function scoreTurns(
  query: PreparedQuery,
  turns: SearchableTurn[],
  relations: Map<number, TurnRelationInfo>,
): Promise<ScoredTurn[]> {
  const scoredTurns: ScoredTurn[] = [];

  for (const turn of turns) {
    if (!turn.text.trim()) {
      continue;
    }

    const turnEmbedding =
      await resolveEmbedding(
        turn.embedding,
        turn.text,
        query.semanticQueryEmbedding.length,
      );

    if (!turnEmbedding) {
      continue;
    }

    const score = calculateSearchScore(
      query,
      turnEmbedding,
      turn.keywords,
      turn.entities,
    );

    scoredTurns.push({
      ...turn,
      embedding: turnEmbedding,
      score,
      relation:
        relations.get(turn.turnIndex) ??
        createEmptyRelation(),
      isTopTurn: false,
    });
  }

  return scoredTurns;
}

/* -------------------------------------------------------------------------- */
/* Span Scoring                                                               */
/* -------------------------------------------------------------------------- */

async function scoreSpan(
  query: PreparedQuery,
  span: SearchableSpan,
): Promise<TurnEvidenceScore> {
  const embedding =
    await resolveEmbedding(
      span.embedding,
      span.text,
      query.semanticQueryEmbedding.length,
    );

  if (!embedding) {
    return createZeroScore();
  }

  return calculateSearchScore(
    query,
    embedding,
    [],
    [],
  );
}

/* -------------------------------------------------------------------------- */
/* Shared Scoring                                                             */
/* -------------------------------------------------------------------------- */

function calculateSearchScore(
  query: PreparedQuery,
  targetEmbedding: number[],
  targetKeywords: string[],
  targetEntities: WindowEntity[],
): TurnEvidenceScore {
  const semanticQuerySimilarity =
    normalizeCosineSimilarity(
      textSimilarity.compareEmbeddingToEmbedding(
        query.semanticQueryEmbedding,
        targetEmbedding,
      ),
    );

  const userMessageSimilarity =
    normalizeCosineSimilarity(
      textSimilarity.compareEmbeddingToEmbedding(
        query.userMessageEmbedding,
        targetEmbedding,
      ),
    );

  const keywordScore =
    calculateKeywordScore(
      query.keywords,
      targetKeywords,
    );

  const entityScore =
    calculateEntityScore(
      query.entities,
      targetEntities,
    );

  const finalScore =
    calculateFinalScore([
      {
        value: semanticQuerySimilarity,
        weight:
          SCORE_WEIGHTS.semanticQuery,
        active: true,
      },
      {
        value: userMessageSimilarity,
        weight:
          SCORE_WEIGHTS.userMessage,
        active: true,
      },
      {
        value: keywordScore,
        weight: SCORE_WEIGHTS.keywords,
        active: query.keywords.length > 0,
      },
      {
        value: entityScore,
        weight: SCORE_WEIGHTS.entities,
        active: query.entities.length > 0,
      },
    ]);

  return {
    semanticQuerySimilarity,
    userMessageSimilarity,
    keywordScore,
    entityScore,
    finalScore,
  };
}

function calculateKeywordScore(
  queryKeywords: string[],
  targetKeywords: string[],
): number {
  if (
    queryKeywords.length === 0 ||
    targetKeywords.length === 0
  ) {
    return 0;
  }

  let totalScore = 0;

  for (const queryKeyword of queryKeywords) {
    if (
      targetKeywords.includes(queryKeyword)
    ) {
      totalScore += 1;
      continue;
    }

    const hasPartialMatch =
      targetKeywords.some(
        (targetKeyword) =>
          targetKeyword.includes(
            queryKeyword,
          ) ||
          queryKeyword.includes(
            targetKeyword,
          ),
      );

    if (hasPartialMatch) {
      totalScore += 0.7;
    }
  }

  return clamp(
    totalScore / queryKeywords.length,
    0,
    1,
  );
}

function calculateEntityScore(
  queryEntities: NormalizedEntity[],
  targetEntities: WindowEntity[],
): number {
  if (
    queryEntities.length === 0 ||
    targetEntities.length === 0
  ) {
    return 0;
  }

  let totalScore = 0;

  for (const queryEntity of queryEntities) {
    let bestScore = 0;

    for (const targetEntity of targetEntities) {
      const targetName = normalizeText(
        targetEntity.normalized ||
          targetEntity.text ||
          "",
      );

      if (!targetName) {
        continue;
      }

      const targetType = normalizeText(
        targetEntity.type ?? "",
      );

      const exactName =
        queryEntity.normalizedName ===
        targetName;

      const exactType =
        Boolean(queryEntity.type) &&
        Boolean(targetType) &&
        queryEntity.type === targetType;

      if (exactName && exactType) {
        bestScore = 1;
        break;
      }

      if (exactName) {
        bestScore = Math.max(
          bestScore,
          0.8,
        );

        continue;
      }

      const partialName =
        targetName.includes(
          queryEntity.normalizedName,
        ) ||
        queryEntity.normalizedName.includes(
          targetName,
        );

      if (partialName) {
        bestScore = Math.max(
          bestScore,
          0.5,
        );
      }
    }

    totalScore += bestScore;
  }

  return clamp(
    totalScore / queryEntities.length,
    0,
    1,
  );
}

function calculateFinalScore(
  components: ScoreComponent[],
): number {
  const activeComponents =
    components.filter(
      (component) => component.active,
    );

  const totalWeight =
    activeComponents.reduce(
      (sum, component) =>
        sum + component.weight,
      0,
    );

  if (totalWeight <= 0) {
    return 0;
  }

  const weightedScore =
    activeComponents.reduce(
      (sum, component) =>
        sum +
        component.value *
          component.weight,
      0,
    );

  return clamp(
    weightedScore / totalWeight,
    0,
    1,
  );
}

function normalizeCosineSimilarity(
  similarity: number,
): number {
  if (!Number.isFinite(similarity)) {
    return 0;
  }

  return clamp(
    (similarity + 1) / 2,
    0,
    1,
  );
}

function createZeroScore():
  TurnEvidenceScore {
  return {
    semanticQuerySimilarity: 0,
    userMessageSimilarity: 0,
    keywordScore: 0,
    entityScore: 0,
    finalScore: 0,
  };
}

function createEmptyRelation():
  TurnRelationInfo {
  return {
    relatedToPrevious: false,
    relatedToNext: false,
    previousRelationScore: 0,
    nextRelationScore: 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Query Preparation                                                          */
/* -------------------------------------------------------------------------- */

async function prepareSearchQuery(
  query: MemoryRetrievalQuery,
  userMessage: string,
): Promise<PreparedQuery> {
  const [
    semanticQueryEmbedding,
    userMessageEmbedding,
  ] = await Promise.all([
    textSimilarity.embedText(
      query.semanticQuery.trim(),
    ),
    textSimilarity.embedText(userMessage),
  ]);

  validateEmbedding(
    semanticQueryEmbedding,
    "semanticQuery",
  );

  validateEmbedding(
    userMessageEmbedding,
    "userMessage",
  );

  if (
    semanticQueryEmbedding.length !==
    userMessageEmbedding.length
  ) {
    throw new Error(
      [
        "The query embeddings have different dimensions.",
        `semanticQuery: ${semanticQueryEmbedding.length}.`,
        `userMessage: ${userMessageEmbedding.length}.`,
      ].join(" "),
    );
  }

  return {
    semanticQueryEmbedding,
    userMessageEmbedding,
    keywords: normalizeKeywords(
      query.keywords,
    ),
    entities: normalizeQueryEntities(
      query.entities,
    ),
  };
}

async function resolveEmbedding(
  storedEmbedding: number[] | null,
  text: string,
  expectedDimensions: number,
): Promise<number[] | null> {
  if (
    storedEmbedding &&
    storedEmbedding.length ===
      expectedDimensions
  ) {
    return storedEmbedding;
  }

  if (!text.trim()) {
    return null;
  }

  const generatedEmbedding =
    await textSimilarity.embedText(text);

  validateEmbedding(
    generatedEmbedding,
    "Turn or Span text",
  );

  if (
    generatedEmbedding.length !==
    expectedDimensions
  ) {
    throw new Error(
      [
        "Generated evidence embedding has an invalid dimension.",
        `Expected: ${expectedDimensions}.`,
        `Received: ${generatedEmbedding.length}.`,
        "Use the same embedding model for indexing and retrieval.",
      ].join(" "),
    );
  }

  return generatedEmbedding;
}

/* -------------------------------------------------------------------------- */
/* Window Loading                                                             */
/* -------------------------------------------------------------------------- */

async function loadWindow(
  windowId: string,
  databasePath: string,
): Promise<MemoryWindow | null> {
  const database = await Database.load(
    `sqlite:${databasePath}`,
  );

  /*
   * No database.close() here: the Tauri SQL plugin keeps one pool per
   * connection string, and close() without a database name closes
   * every pool — including the shared databaseManager's pool.
   * Database.load always replaces the pool, so leaving it open is
   * safe.
   */
  {
    const rows =
      await database.select<RecordRow[]>(
        `
          SELECT
            record_key,
            payload
          FROM records
          WHERE record_type = 'window'
            AND record_key = ?
          LIMIT 1
        `,
        [windowId],
      );

    const row = rows[0];

    if (
      !row ||
      typeof row.payload !== "string" ||
      !row.payload.trim()
    ) {
      return null;
    }

    let payload: unknown;

    try {
      payload = JSON.parse(row.payload);
    } catch {
      return null;
    }

    if (!isRecord(payload)) {
      return null;
    }

    if (
      typeof payload.id !== "string" ||
      !payload.id.trim()
    ) {
      return null;
    }

    return payload as unknown as MemoryWindow;
  }
}

/* -------------------------------------------------------------------------- */
/* Turn Extraction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Extracts the searchable Turns of a Window.
 *
 * The extraction targets the stored Turn shape:
 *
 * Turn {
 *   userMessage, agentResponse,
 *   spans: [{ tag, type, content, ... }],
 *   indexes: { subject, keywords, entities, embedding,
 *              spanEmbeddings: [{ spanIndex, tag, embedding }] }
 * }
 */
function extractSearchableTurns(
  window: MemoryWindow,
): SearchableTurn[] {
  const turns: SearchableTurn[] = [];

  const rawTurns = Array.isArray(
    window.turns,
  )
    ? window.turns
    : [];

  for (
    let turnIndex = 0;
    turnIndex < rawTurns.length;
    turnIndex += 1
  ) {
    const turn = rawTurns[turnIndex];

    if (!isRecord(turn)) {
      continue;
    }

    const userMessage =
      typeof turn.userMessage === "string"
        ? turn.userMessage.trim()
        : "";

    const agentResponse =
      typeof turn.agentResponse === "string"
        ? turn.agentResponse.trim()
        : "";

    const text = [
      userMessage
        ? `User:\n${userMessage}`
        : "",
      agentResponse
        ? `Assistant:\n${agentResponse}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (!text) {
      continue;
    }

    const indexes: UnknownRecord =
      isRecord(turn.indexes)
        ? turn.indexes
        : {};

    turns.push({
      turnIndex,
      text,
      keywords: normalizeKeywords(
        indexes.keywords,
      ),
      entities: normalizeStoredEntities(
        indexes.entities,
      ),
      embedding: extractEmbedding(
        indexes.embedding,
      ),
      storedSpans: extractStoredSpans(
        turn,
        indexes,
      ),
    });
  }

  return turns;
}

/* -------------------------------------------------------------------------- */
/* Stored Span Extraction                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Extracts the stored agent Spans of one Turn together with their
 * span embeddings.
 *
 * The Turn payload stores:
 * - spans: [{ tag, type, content, estimatedTokenCount }]
 * - indexes.spanEmbeddings: [{ spanIndex, tag, embedding }]
 *
 * Spans without an embedding are still returned; the embedding is
 * generated on demand during scoring.
 */
function extractStoredSpans(
  turn: UnknownRecord,
  indexes: UnknownRecord,
): SearchableSpan[] {
  const rawSpans = Array.isArray(turn.spans)
    ? turn.spans
    : [];

  const spanEmbeddings = Array.isArray(
    indexes.spanEmbeddings,
  )
    ? indexes.spanEmbeddings
    : [];

  const embeddingByIndex =
    new Map<number, number[]>();

  const embeddingByTag =
    new Map<string, number[]>();

  for (const entry of spanEmbeddings) {
    if (!isRecord(entry)) {
      continue;
    }

    const embedding = extractEmbedding(
      entry.embedding,
    );

    if (!embedding) {
      continue;
    }

    if (
      typeof entry.spanIndex === "number" &&
      Number.isInteger(entry.spanIndex)
    ) {
      embeddingByIndex.set(
        entry.spanIndex,
        embedding,
      );
    }

    if (typeof entry.tag === "string") {
      embeddingByTag.set(
        normalizeText(entry.tag),
        embedding,
      );
    }
  }

  const spans: SearchableSpan[] = [];

  for (
    let spanIndex = 0;
    spanIndex < rawSpans.length;
    spanIndex += 1
  ) {
    const rawSpan = rawSpans[spanIndex];

    if (!isRecord(rawSpan)) {
      continue;
    }

    const content =
      typeof rawSpan.content === "string"
        ? rawSpan.content.trim()
        : "";

    if (!content) {
      continue;
    }

    const tag =
      typeof rawSpan.tag === "string"
        ? rawSpan.tag.trim()
        : "";

    const embedding =
      embeddingByIndex.get(spanIndex) ??
      (tag
        ? embeddingByTag.get(
            normalizeText(tag),
          ) ?? null
        : null);

    spans.push({
      spanIndex,
      tag,
      text: content,
      embedding,
    });
  }

  return spans;
}

/* -------------------------------------------------------------------------- */
/* Safe Fallback Span Creation                                                */
/* -------------------------------------------------------------------------- */

/**
 * Used only when persisted Spans do not exist.
 *
 * It splits a Turn into atomic blocks without cutting:
 *
 * - fenced code blocks,
 * - paragraphs,
 * - complete sentences.
 *
 * A code block is always kept as one atomic unit.
 */
function createSafeFallbackSpans(
  text: string,
): SearchableSpan[] {
  const blocks =
    splitPreservingCodeBlocks(text);

  const atomicTexts: string[] = [];

  for (const block of blocks) {
    if (isFencedCodeBlock(block)) {
      atomicTexts.push(block.trim());
      continue;
    }

    const paragraphs = block
      .split(/\n\s*\n/u)
      .map((paragraph) =>
        paragraph.trim(),
      )
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      /*
       * Keep structured content intact. Splitting lists or headings
       * line-by-line could remove the relationship between items.
       */
      if (
        looksStructured(paragraph) ||
        paragraph.length <= 1200
      ) {
        atomicTexts.push(paragraph);
        continue;
      }

      const sentences =
        splitIntoCompleteSentences(
          paragraph,
        );

      if (sentences.length > 1) {
        atomicTexts.push(...sentences);
      } else {
        atomicTexts.push(paragraph);
      }
    }
  }

  return atomicTexts
    .filter(Boolean)
    .map((atomicText, spanIndex) => ({
      spanIndex,
      tag: "",
      text: atomicText,
      embedding: null,
    }));
}

function splitPreservingCodeBlocks(
  text: string,
): string[] {
  const parts =
    text.split(/(```[\s\S]*?```)/gu);

  return parts
    .map((part) => part.trim())
    .filter(Boolean);
}

function isFencedCodeBlock(
  text: string,
): boolean {
  const trimmed = text.trim();

  return (
    trimmed.startsWith("```") &&
    trimmed.endsWith("```")
  );
}

function looksStructured(
  text: string,
): boolean {
  return (
    /(^|\n)\s*(?:[-*+]|\d+[.)])\s+/u.test(
      text,
    ) ||
    /(^|\n)\s*#{1,6}\s+/u.test(text) ||
    /(^|\n)\s*>/u.test(text) ||
    /(^|\n)\s*\|.+\|/u.test(text)
  );
}

function splitIntoCompleteSentences(
  text: string,
): string[] {
  const matches = text.match(
    /[^.!?\u061F\u061B\n]+(?:[.!?\u061F\u061B]+|$)/gu,
  );

  if (!matches) {
    return [text.trim()].filter(Boolean);
  }

  return matches
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Context Formatting                                                         */
/* -------------------------------------------------------------------------- */

function buildContextText(
  turns: SelectedTurnEvidence[],
): string {
  return [...turns]
    .sort(
      (first, second) =>
        first.turnIndex -
        second.turnIndex,
    )
    .map((turn) => turn.text.trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/* -------------------------------------------------------------------------- */
/* Token Counting                                                             */
/* -------------------------------------------------------------------------- */

function createTokenCounter(
  customCounter:
    TurnEvidenceSearchOptions["countTokens"],
): TokenCounter {
  if (customCounter) {
    return async (text: string) => {
      const result =
        await customCounter(text);

      if (
        !Number.isFinite(result) ||
        result < 0
      ) {
        throw new Error(
          "The custom token counter returned an invalid value.",
        );
      }

      return Math.ceil(result);
    };
  }

  return async (text: string) =>
    estimateTokenCount(text);
}

/**
 * Conservative fallback estimation.
 *
 * This is not a replacement for the tokenizer of the final model.
 * Persian text is usually more token-expensive than plain English,
 * so non-ASCII characters receive a larger estimated cost.
 */
function estimateTokenCount(
  text: string,
): number {
  const normalized = text.trim();

  if (!normalized) {
    return 0;
  }

  const asciiCharacters =
    normalized.match(/[\x00-\x7F]/gu)
      ?.length ?? 0;

  const nonAsciiCharacters =
    normalized.length - asciiCharacters;

  const asciiTokens =
    asciiCharacters / 4;

  const nonAsciiTokens =
    nonAsciiCharacters / 2;

  return Math.max(
    1,
    Math.ceil(
      asciiTokens + nonAsciiTokens,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

function normalizeKeywords(
  keywords: unknown,
): string[] {
  if (!Array.isArray(keywords)) {
    return [];
  }

  return [
    ...new Set(
      keywords
        .filter(
          (keyword): keyword is string =>
            typeof keyword === "string",
        )
        .map(normalizeText)
        .filter(Boolean),
    ),
  ];
}

function normalizeQueryEntities(
  entities: MemoryQueryEntity[],
): NormalizedEntity[] {
  if (!Array.isArray(entities)) {
    return [];
  }

  const uniqueEntities =
    new Map<string, NormalizedEntity>();

  for (const entity of entities) {
    const normalizedName =
      normalizeText(
        entity?.normalizedName ||
          entity?.name ||
          "",
      );

    if (!normalizedName) {
      continue;
    }

    const type = normalizeText(
      entity?.type ?? "",
    );

    const key = [
      normalizedName,
      type,
    ].join(":");

    if (!uniqueEntities.has(key)) {
      uniqueEntities.set(key, {
        normalizedName,
        type,
      });
    }
  }

  return [...uniqueEntities.values()];
}

function normalizeStoredEntities(
  entities: unknown,
): WindowEntity[] {
  if (!Array.isArray(entities)) {
    return [];
  }

  const uniqueEntities =
    new Map<string, WindowEntity>();

  for (const entity of entities) {
    if (!isRecord(entity)) {
      continue;
    }

    const text =
      typeof entity.text === "string"
        ? entity.text.trim()
        : "";

    const normalized =
      normalizeText(
        typeof entity.normalized ===
          "string"
          ? entity.normalized
          : text,
      );

    if (!normalized) {
      continue;
    }

    const type =
      typeof entity.type === "string"
        ? entity.type.trim()
        : "";

    const key = [
      normalized,
      normalizeText(type),
    ].join(":");

    if (!uniqueEntities.has(key)) {
      uniqueEntities.set(key, {
        text,
        normalized,
        type,
      });
    }
  }

  return [...uniqueEntities.values()];
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                    */
/* -------------------------------------------------------------------------- */

function compareTurnsByScore(
  first: ScoredTurn,
  second: ScoredTurn,
): number {
  const scoreDifference =
    second.score.finalScore -
    first.score.finalScore;

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return (
    first.turnIndex -
    second.turnIndex
  );
}

function compareTurnsChronologically(
  first: ScoredTurn,
  second: ScoredTurn,
): number {
  return (
    first.turnIndex -
    second.turnIndex
  );
}

function compareSpanCandidatesByScore(
  first: ScoredSpan,
  second: ScoredSpan,
): number {
  const scoreDifference =
    second.selectionScore -
    first.selectionScore;

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  if (
    first.turnIndex !==
    second.turnIndex
  ) {
    return (
      first.turnIndex -
      second.turnIndex
    );
  }

  return (
    first.spanIndex -
    second.spanIndex
  );
}

function containsSpanCandidate(
  selected: ScoredSpan[],
  candidate: ScoredSpan,
): boolean {
  return selected.some(
    (item) =>
      item.turnIndex ===
        candidate.turnIndex &&
      item.spanIndex ===
        candidate.spanIndex,
  );
}

/* -------------------------------------------------------------------------- */
/* Generic Data Helpers                                                       */
/* -------------------------------------------------------------------------- */

interface UnknownRecord {
  [key: string]: unknown;
}

function isRecord(
  value: unknown,
): value is UnknownRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function extractEmbedding(
  value: unknown,
): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (
    value.length === 0 ||
    !value.every(
      (item) =>
        typeof item === "number" &&
        Number.isFinite(item),
    )
  ) {
    return null;
  }

  return value as number[];
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function validateBuildMemoryQueryInput(
  input: BuildMemoryQueryInput,
): string {
  if (!input || typeof input !== "object") {
    throw new Error(
      "A memory query input is required.",
    );
  }

  return validateUserMessage(
    input.userMessage,
  );
}

function validateUserMessage(
  userMessage: string,
): string {
  if (typeof userMessage !== "string") {
    throw new Error(
      "The user message must be a string.",
    );
  }

  const normalized =
    userMessage.trim();

  if (!normalized) {
    throw new Error(
      "The user message cannot be empty.",
    );
  }

  return normalized;
}

function validateMemoryQuery(
  query: MemoryRetrievalQuery,
): void {
  if (!query || typeof query !== "object") {
    throw new Error(
      "A memory retrieval query is required.",
    );
  }

  if (
    typeof query.semanticQuery !== "string" ||
    !query.semanticQuery.trim()
  ) {
    throw new Error(
      "semanticQuery is required.",
    );
  }

  if (!Array.isArray(query.keywords)) {
    throw new Error(
      "keywords must be an array.",
    );
  }

  if (!Array.isArray(query.entities)) {
    throw new Error(
      "entities must be an array.",
    );
  }
}

function validateWindowSearchResult(
  window: WindowSearchResult,
): void {
  if (
    !window ||
    typeof window !== "object"
  ) {
    throw new Error(
      "A Window search result is required.",
    );
  }

  if (
    typeof window.windowId !== "string" ||
    !window.windowId.trim()
  ) {
    throw new Error(
      "The Window search result has no valid windowId.",
    );
  }

  if (
    !window.episode ||
    typeof window.episode !== "object"
  ) {
    throw new Error(
      "The Window search result has no Episode result.",
    );
  }
}

function validateEmbedding(
  embedding: number[],
  source: string,
): void {
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    !embedding.every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value),
    )
  ) {
    throw new Error(
      `The embedding generated for "${source}" is invalid.`,
    );
  }
}

function normalizeDatabasePath(
  databasePath: string,
): string {
  if (typeof databasePath !== "string") {
    throw new Error(
      "The database path must be a string.",
    );
  }

  const normalized =
    databasePath.trim();

  if (!normalized) {
    throw new Error(
      "The database path cannot be empty.",
    );
  }

  return normalized
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      `${name} must be a positive integer.`,
    );
  }

  return value;
}
