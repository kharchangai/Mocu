// memory-retrieval/windowSearchEngine.ts

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
  searchEpisodes,
  type EpisodeSearchResult,
} from "./episodeSearchEngine";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface WindowSearchScore {
  semanticQuerySimilarity: number;
  userMessageSimilarity: number;
  keywordScore: number;
  entityScore: number;
  finalScore: number;
}

export interface WindowSearchResult {
  windowId: string;
  episodeId: string;
  sessionId: string;
  subject: string;
  keywords: string[];
  entities: WindowEntity[];
  score: WindowSearchScore;

  /**
   * The episode the window was found in.
   */
  episode: EpisodeSearchResult;
}

interface WindowRecordRow {
  record_key: string;
  payload: string;
}

interface EpisodeRecordRow {
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
  name: string;
  normalizedName: string;
  type: string;
}

interface ScoreComponent {
  value: number;
  weight: number;
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MINIMUM_SCORE = 0.55;

const SCORE_WEIGHTS = {
  semanticQuery: 0.5,
  userMessage: 0.2,
  keywords: 0.15,
  entities: 0.15,
} as const;

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Finds the best matching Window in two steps:
 *
 * 1. Episode search: the memory query is built from the input and the
 *    best Episode is found in the SQLite database (episodeSearchEngine).
 * 2. Window search: the Windows of the found Episode (episode.windowIds)
 *    are loaded and the best matching Window is returned.
 *
 * The memory query is built only once and reused for both steps.
 *
 * @param input Memory-query input containing the current user message.
 * @param databasePath Location of the SQLite database file.
 * @returns The best matching Window or null.
 */
export async function findBestWindow(
  input: BuildMemoryQueryInput,
  databasePath: string,
): Promise<WindowSearchResult | null> {
  const userMessage =
    validateBuildMemoryQueryInput(input);

  const normalizedDatabasePath =
    normalizeDatabasePath(databasePath);

  const query = await buildMemoryQuery(input);

  /* ---------------------------------------------------------------- */
  /* Step 1: find the best episode                                    */
  /* ---------------------------------------------------------------- */
  const episode = await searchEpisodes(
    query,
    userMessage,
    normalizedDatabasePath,
  );

  if (!episode) {
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Step 2: find the best window inside the episode                  */
  /* ---------------------------------------------------------------- */
  return searchWindowsInEpisode(
    query,
    userMessage,
    episode,
    normalizedDatabasePath,
  );
}

/**
 * Searches for the best matching Window inside one already found
 * Episode using an already built MemoryRetrievalQuery.
 *
 * Only the Windows listed in episode.windowIds are searched.
 *
 * @param query Query previously created by buildMemoryQuery.
 * @param userMessage Current user message.
 * @param episode Episode result returned by the episode search.
 * @param databasePath Location of the SQLite database file.
 * @returns The best matching Window or null.
 */
export async function searchWindowsInEpisode(
  query: MemoryRetrievalQuery,
  userMessage: string,
  episode: EpisodeSearchResult,
  databasePath: string,
): Promise<WindowSearchResult | null> {
  validateMemoryQuery(query);

  const normalizedUserMessage =
    validateUserMessage(userMessage);

  if (!episode || typeof episode !== "object") {
    throw new Error(
      "An episode search result is required.",
    );
  }

  const normalizedDatabasePath =
    normalizeDatabasePath(databasePath);

  const preparedQuery = await prepareSearchQuery(
    query,
    normalizedUserMessage,
  );

  const windows = await loadEpisodeWindows(
    episode,
    normalizedDatabasePath,
  );

  if (windows.length === 0) {
    return null;
  }

  const scoredWindows: WindowSearchResult[] = [];

  for (const window of windows) {
    const result = scoreWindow(
      preparedQuery,
      window,
      episode,
    );

    if (result !== null) {
      scoredWindows.push(result);
    }
  }

  if (scoredWindows.length === 0) {
    return null;
  }

  scoredWindows.sort(
    (first, second) =>
      second.score.finalScore -
      first.score.finalScore,
  );

  const bestWindow = scoredWindows[0];

  if (!bestWindow) {
    return null;
  }

  if (bestWindow.score.finalScore < MINIMUM_SCORE) {
    return null;
  }

  return bestWindow;
}

/* -------------------------------------------------------------------------- */
/* Input Validation                                                           */
/* -------------------------------------------------------------------------- */

function validateBuildMemoryQueryInput(
  input: BuildMemoryQueryInput,
): string {
  if (!input || typeof input !== "object") {
    throw new Error(
      "A memory query input is required.",
    );
  }

  return validateUserMessage(input.userMessage);
}

function validateUserMessage(
  userMessage: string,
): string {
  if (typeof userMessage !== "string") {
    throw new Error(
      "The user message must be a string.",
    );
  }

  const normalizedUserMessage =
    userMessage.trim();

  if (!normalizedUserMessage) {
    throw new Error(
      "The user message cannot be empty.",
    );
  }

  return normalizedUserMessage;
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
    query.semanticQuery.trim().length === 0
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

/* -------------------------------------------------------------------------- */
/* Query Preparation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Embeds semanticQuery and userMessage with the configured embedding
 * model and normalizes keywords and entities.
 */
async function prepareSearchQuery(
  query: MemoryRetrievalQuery,
  userMessage: string,
): Promise<PreparedQuery> {
  const semanticQuery =
    query.semanticQuery.trim();

  const [
    semanticQueryEmbedding,
    userMessageEmbedding,
  ] = await Promise.all([
    textSimilarity.embedText(semanticQuery),
    textSimilarity.embedText(userMessage),
  ]);

  validateGeneratedEmbedding(
    semanticQueryEmbedding,
    "semanticQuery",
  );

  validateGeneratedEmbedding(
    userMessageEmbedding,
    "userMessage",
  );

  return {
    semanticQueryEmbedding,
    userMessageEmbedding,
    keywords: normalizeKeywords(query.keywords),
    entities: normalizeEntities(query.entities),
  };
}

/* -------------------------------------------------------------------------- */
/* Database Reading                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes a database file path to forward slashes and removes
 * trailing separators, so the Tauri SQL connection string accepts it
 * on every platform.
 */
function normalizeDatabasePath(
  databasePath: string,
): string {
  const trimmedPath = databasePath.trim();

  if (!trimmedPath) {
    throw new Error(
      "The database path cannot be empty.",
    );
  }

  return trimmedPath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/**
 * Reads the windowIds of an Episode from the SQLite database.
 *
 * The Episode payload (record_type = 'episode') contains the windowIds
 * field with the record keys of all member Windows. Invalid or missing
 * windowIds entries are filtered out.
 */
async function loadEpisodeWindowIds(
  episodeId: string,
  databasePath: string,
): Promise<string[]> {
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
      await database.select<EpisodeRecordRow[]>(
        `
          SELECT
            record_key,
            payload
          FROM records
          WHERE record_type = 'episode'
            AND record_key = ?
          LIMIT 1
        `,
        [episodeId],
      );

    const row = rows[0];

    if (!row?.payload) {
      return [];
    }

    let payload: unknown;

    try {
      payload = JSON.parse(row.payload);
    } catch {
      return [];
    }

    const windowIds =
      (payload as { windowIds?: unknown })
        ?.windowIds;

    if (!Array.isArray(windowIds)) {
      return [];
    }

    return windowIds.filter(
      (windowId): windowId is string =>
        typeof windowId === "string" &&
        windowId.trim().length > 0,
    );
  }
}

/**
 * Loads the Windows of an Episode from the SQLite database.
 *
 * The episodeId of the search result is the record_key of the Episode
 * record. The Episode payload contains the windowIds field, which
 * lists the record keys of all member Windows. Only these Windows are
 * loaded.
 */
async function loadEpisodeWindows(
  episode: EpisodeSearchResult,
  databasePath: string,
): Promise<MemoryWindow[]> {
  const windowIds = await loadEpisodeWindowIds(
    episode.episodeId,
    databasePath,
  );

  if (windowIds.length === 0) {
    return [];
  }

  const placeholders = windowIds
    .map(() => "?")
    .join(", ");

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
      await database.select<WindowRecordRow[]>(
        `
          SELECT
            record_key,
            payload
          FROM records
          WHERE record_type = 'window'
            AND record_key IN (${placeholders})
        `,
        windowIds,
      );

    const windows: MemoryWindow[] = [];

    for (const row of rows) {
      const window = parseWindowPayload(row);

      if (window !== null) {
        windows.push(window);
      }
    }

    return windows;
  }
}

/**
 * Parses one serialized Window payload.
 *
 * Invalid records and Windows without a usable embedding are skipped.
 */
function parseWindowPayload(
  row: WindowRecordRow,
): MemoryWindow | null {
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

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }

  const window =
    payload as Partial<MemoryWindow>;

  if (
    typeof window.id !== "string" ||
    !window.id.trim()
  ) {
    return null;
  }

  if (!window.indexes) {
    return null;
  }

  if (
    !Array.isArray(window.indexes.embedding) ||
    window.indexes.embedding.length === 0 ||
    !window.indexes.embedding.every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value),
    )
  ) {
    return null;
  }

  return window as MemoryWindow;
}

/**
 * Merges the entities of all Turns in a Window in insertion order.
 *
 * The Window indexes do not contain entities; they are stored on the
 * Turn indexes.
 */
function collectWindowEntities(
  window: MemoryWindow,
): WindowEntity[] {
  const uniqueEntities = new Map<
    string,
    WindowEntity
  >();

  const turns = Array.isArray(window.turns)
    ? window.turns
    : [];

  for (const turn of turns) {
    const turnEntities =
      turn?.indexes?.entities ?? [];

    if (!Array.isArray(turnEntities)) {
      continue;
    }

    for (const entity of turnEntities) {
      if (
        !entity ||
        typeof entity !== "object"
      ) {
        continue;
      }

      const normalized =
        normalizeText(
          entity.normalized || entity.text || "",
        );

      if (!normalized) {
        continue;
      }

      const identityKey = [
        normalized,
        normalizeText(entity.type ?? ""),
      ].join(":");

      if (!uniqueEntities.has(identityKey)) {
        uniqueEntities.set(identityKey, {
          text:
            typeof entity.text === "string"
              ? entity.text
              : "",
          normalized,
          type:
            typeof entity.type === "string"
              ? entity.type
              : "",
        });
      }
    }
  }

  return [...uniqueEntities.values()];
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Calculates all retrieval scores for one Window.
 */
function scoreWindow(
  query: PreparedQuery,
  window: MemoryWindow,
  episode: EpisodeSearchResult,
): WindowSearchResult | null {
  const windowEmbedding =
    window.indexes?.embedding;

  if (
    !Array.isArray(windowEmbedding) ||
    windowEmbedding.length === 0
  ) {
    return null;
  }

  validateEmbeddingDimensions(
    query.semanticQueryEmbedding,
    windowEmbedding,
    window.id,
  );

  const windowKeywords =
    normalizeKeywords(
      window.indexes.keywords ?? [],
    );

  const windowEntities =
    collectWindowEntities(window);

  const semanticQuerySimilarity =
    normalizeCosineSimilarity(
      textSimilarity.compareEmbeddingToEmbedding(
        query.semanticQueryEmbedding,
        windowEmbedding,
      ),
    );

  const userMessageSimilarity =
    normalizeCosineSimilarity(
      textSimilarity.compareEmbeddingToEmbedding(
        query.userMessageEmbedding,
        windowEmbedding,
      ),
    );

  const keywordScore = calculateKeywordScore(
    query.keywords,
    windowKeywords,
  );

  const entityScore = calculateEntityScore(
    query.entities,
    windowEntities,
  );

  const finalScore = calculateFinalScore([
    {
      value: semanticQuerySimilarity,
      weight: SCORE_WEIGHTS.semanticQuery,
      active: true,
    },
    {
      value: userMessageSimilarity,
      weight: SCORE_WEIGHTS.userMessage,
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

  const subjects =
    Array.isArray(window.indexes.subjects)
      ? window.indexes.subjects
      : [];

  return {
    windowId: window.id,
    episodeId: episode.episodeId,
    sessionId:
      typeof window.sessionId === "string"
        ? window.sessionId
        : episode.sessionId,
    subject:
      subjects.length > 0
        ? subjects[subjects.length - 1]
        : "",
    keywords: windowKeywords,
    entities: windowEntities,
    score: {
      semanticQuerySimilarity,
      userMessageSimilarity,
      keywordScore,
      entityScore,
      finalScore,
    },
    episode,
  };
}

/**
 * Converts cosine similarity from -1..1 to 0..1.
 */
function normalizeCosineSimilarity(
  similarity: number,
): number {
  if (!Number.isFinite(similarity)) {
    return 0;
  }

  const normalized =
    (similarity + 1) / 2;

  return clamp(normalized, 0, 1);
}

/**
 * Calculates query-keyword coverage.
 *
 * Exact match:   1.0
 * Partial match: 0.7
 * No match:      0.0
 */
function calculateKeywordScore(
  queryKeywords: string[],
  windowKeywords: string[],
): number {
  if (queryKeywords.length === 0) {
    return 0;
  }

  if (windowKeywords.length === 0) {
    return 0;
  }

  const windowKeywordSet = new Set(
    windowKeywords,
  );

  let matchedKeywords = 0;

  for (const queryKeyword of queryKeywords) {
    if (windowKeywordSet.has(queryKeyword)) {
      matchedKeywords += 1;
      continue;
    }

    const partialMatch =
      windowKeywords.some(
        (windowKeyword) =>
          windowKeyword.includes(queryKeyword) ||
          queryKeyword.includes(windowKeyword),
      );

    if (partialMatch) {
      matchedKeywords += 0.7;
    }
  }

  return clamp(
    matchedKeywords / queryKeywords.length,
    0,
    1,
  );
}

/**
 * Entity scoring rules:
 *
 * Same normalized name and same type: 1.0
 * Same normalized name only:          0.8
 * Partial normalized-name match:      0.5
 * No match:                           0.0
 */
function calculateEntityScore(
  queryEntities: NormalizedEntity[],
  windowEntities: WindowEntity[],
): number {
  if (queryEntities.length === 0) {
    return 0;
  }

  if (windowEntities.length === 0) {
    return 0;
  }

  let totalScore = 0;

  for (const queryEntity of queryEntities) {
    let bestMatchScore = 0;

    for (const windowEntity of windowEntities) {
      const windowNormalizedName =
        normalizeText(
          windowEntity.normalized ||
            windowEntity.text ||
            "",
        );

      if (!windowNormalizedName) {
        continue;
      }

      const windowEntityType =
        normalizeText(
          windowEntity.type ?? "",
        );

      const nameMatches =
        queryEntity.normalizedName ===
        windowNormalizedName;

      const typeMatches =
        Boolean(queryEntity.type) &&
        Boolean(windowEntityType) &&
        queryEntity.type === windowEntityType;

      if (nameMatches && typeMatches) {
        bestMatchScore = 1;
        break;
      }

      if (nameMatches) {
        bestMatchScore = Math.max(
          bestMatchScore,
          0.8,
        );

        continue;
      }

      const partialNameMatch =
        windowNormalizedName.includes(
          queryEntity.normalizedName,
        ) ||
        queryEntity.normalizedName.includes(
          windowNormalizedName,
        );

      if (partialNameMatch) {
        bestMatchScore = Math.max(
          bestMatchScore,
          0.5,
        );
      }
    }

    totalScore += bestMatchScore;
  }

  return clamp(
    totalScore / queryEntities.length,
    0,
    1,
  );
}

/**
 * Calculates a weighted score and automatically removes the weight of
 * unavailable query signals.
 *
 * For example, when the query contains no entities, the entity weight
 * is removed and the remaining weights are normalized.
 */
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

  if (totalWeight === 0) {
    return 0;
  }

  const weightedScore =
    activeComponents.reduce(
      (sum, component) =>
        sum +
        component.value * component.weight,
      0,
    );

  return clamp(
    weightedScore / totalWeight,
    0,
    1,
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

  const normalizedKeywords = keywords
    .filter(
      (keyword): keyword is string =>
        typeof keyword === "string",
    )
    .map(normalizeText)
    .filter(
      (keyword) => keyword.length > 0,
    );

  return [
    ...new Set(normalizedKeywords),
  ];
}

function normalizeEntities(
  entities: MemoryQueryEntity[],
): NormalizedEntity[] {
  if (!Array.isArray(entities)) {
    return [];
  }

  const normalizedEntities =
    entities
      .map((entity) => {
        const name =
          typeof entity?.name === "string"
            ? entity.name.trim()
            : "";

        const normalizedName =
          normalizeText(
            (entity?.normalizedName ||
              entity?.name) ??
              "",
          );

        const type =
          typeof entity?.type === "string"
            ? normalizeText(entity.type)
            : "";

        return {
          name,
          normalizedName,
          type,
        };
      })
      .filter(
        (entity) =>
          entity.normalizedName.length > 0,
      );

  const uniqueEntities =
    new Map<string, NormalizedEntity>();

  for (const entity of normalizedEntities) {
    const key = [
      entity.normalizedName,
      entity.type,
    ].join(":");

    if (!uniqueEntities.has(key)) {
      uniqueEntities.set(key, entity);
    }
  }

  return [...uniqueEntities.values()];
}

/* -------------------------------------------------------------------------- */
/* Validation Helpers                                                         */
/* -------------------------------------------------------------------------- */

function validateGeneratedEmbedding(
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

function validateEmbeddingDimensions(
  queryEmbedding: number[],
  windowEmbedding: number[],
  windowId: string,
): void {
  if (
    queryEmbedding.length !==
    windowEmbedding.length
  ) {
    throw new Error(
      [
        `Embedding dimension mismatch for window "${windowId}".`,
        `Query dimension: ${queryEmbedding.length}.`,
        `Window dimension: ${windowEmbedding.length}.`,
        "Both embeddings must be generated with the same model.",
      ].join(" "),
    );
  }
}
