// memory-retrieval/episodeSearchEngine.ts

import Database from "@tauri-apps/plugin-sql";

import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";
import type {
  MemoryEpisode,
} from "../episode/types";
import type {
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

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface EpisodeSearchScore {
  semanticQuerySimilarity: number;
  userMessageSimilarity: number;
  keywordScore: number;
  entityScore: number;
  finalScore: number;
}

export interface EpisodeSearchResult {
  episodeId: string;
  sessionId: string;
  subject: string;
  keywords: string[];
  entities: WindowEntity[];
  score: EpisodeSearchScore;
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
 * Searches for the most relevant Episode.
 *
 * The search is based on a BuildMemoryQueryInput:
 *
 * 1. The input is sent to buildMemoryQuery, which uses the LLM to
 *    create a MemoryRetrievalQuery (semanticQuery + keywords +
 *    entities).
 * 2. All Episodes are loaded from the SQLite database at the given
 *    location.
 * 3. semanticQuery and userMessage are embedded with the configured
 *    embedding model (TextSimilarity) and compared against every
 *    Episode embedding.
 * 4. The best Episode above the minimum score is returned.
 *
 * @param input Memory query input (mode + user message + optional
 *              previous turn).
 * @param databasePath Location of the SQLite database file.
 * @returns The best matching Episode or null.
 */
export async function findBestEpisode(
  input: BuildMemoryQueryInput,
  databasePath: string,
): Promise<EpisodeSearchResult | null> {
  const userMessage =
    validateBuildMemoryQueryInput(input);

  const query = await buildMemoryQuery(input);

  return searchEpisodes(
    query,
    userMessage,
    databasePath,
  );
}

/**
 * Returns the most recently persisted Episode of the SQLite
 * database without any scoring.
 *
 * Used when the continuity analysis selects "PREVIOUS_TURN": the
 * last turn of the last Window of the last Episode is returned as
 * related memory instead of running the search pipeline.
 *
 * Returns null when the database contains no Episode records.
 *
 * @param databasePath Location of the SQLite database file.
 */
export async function findLastEpisode(
  databasePath: string,
): Promise<MemoryEpisode | null> {
  const normalizedPath =
    normalizeDatabasePath(databasePath);

  const database = await Database.load(
    `sqlite:${normalizedPath}`,
  );

  /*
   * No database.close() here: the Tauri SQL plugin keeps one pool
   * per connection string, and close() without a database name
   * closes every pool — including the shared databaseManager's
   * pool. Database.load always replaces the pool, so leaving it
   * open is safe.
   */
  {
    const rows =
      await database.select<EpisodeRecordRow[]>(`
        SELECT
          record_key,
          payload
        FROM records
        WHERE record_type = 'episode'
        ORDER BY
          created_at DESC,
          record_key DESC
        LIMIT 1
      `);

    const row = rows[0];

    if (!row) {
      return null;
    }

    return parseEpisodePayload(row);
  }
}

/**
 * Searches for the most relevant Episode using an already built
 * memory query (the return value of buildMemoryQuery) and the user
 * message the query was built from.
 *
 * @param query Memory retrieval query (semanticQuery + keywords +
 *              entities).
 * @param userMessage The current user message.
 * @param databasePath Location of the SQLite database file.
 * @returns The best matching Episode or null.
 */
export async function searchEpisodes(
  query: MemoryRetrievalQuery,
  userMessage: string,
  databasePath: string,
): Promise<EpisodeSearchResult | null> {
  validateMemoryQuery(query);

  const normalizedUserMessage =
    validateUserMessage(userMessage);

  const preparedQuery = await prepareSearchQuery(
    query,
    normalizedUserMessage,
  );

  const episodes = await loadEpisodes(
    databasePath,
  );

  if (episodes.length === 0) {
    return null;
  }

  const scoredEpisodes: EpisodeSearchResult[] =
    [];

  for (const episode of episodes) {
    const result = scoreEpisode(
      preparedQuery,
      episode,
    );

    if (result !== null) {
      scoredEpisodes.push(result);
    }
  }

  if (scoredEpisodes.length === 0) {
    return null;
  }

  scoredEpisodes.sort(
    (first, second) =>
      second.score.finalScore -
      first.score.finalScore,
  );

  const bestEpisode = scoredEpisodes[0];

  if (!bestEpisode) {
    return null;
  }

  if (bestEpisode.score.finalScore < MINIMUM_SCORE) {
    return null;
  }

  return bestEpisode;
}

/* -------------------------------------------------------------------------- */
/* Input Validation                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Validates a BuildMemoryQueryInput and returns the trimmed user
 * message.
 */
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
 * Loads all persisted Episodes from the SQLite database at the given
 * location.
 *
 * Episodes are stored in the records table with the record type
 * "episode" and a serialized MemoryEpisode payload. Records with an
 * invalid payload or without a usable embedding are skipped.
 */
async function loadEpisodes(
  databasePath: string,
): Promise<MemoryEpisode[]> {
  const normalizedPath =
    normalizeDatabasePath(databasePath);

  const database = await Database.load(
    `sqlite:${normalizedPath}`,
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
      await database.select<EpisodeRecordRow[]>(`
        SELECT
          record_key,
          payload
        FROM records
        WHERE record_type = 'episode'
      `);

    const episodes: MemoryEpisode[] = [];

    for (const row of rows) {
      const episode =
        parseEpisodePayload(row);

      if (episode !== null) {
        episodes.push(episode);
      }
    }

    return episodes;
  }
}

/**
 * Parses one Episode payload. Returns null when the record is not a
 * usable MemoryEpisode.
 */
function parseEpisodePayload(
  row: EpisodeRecordRow,
): MemoryEpisode | null {
  if (!row?.payload) {
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

  const episode = payload as Partial<MemoryEpisode>;

  if (
    typeof episode.id !== "string" ||
    !episode.id.trim() ||
    !episode.indexes ||
    !Array.isArray(episode.indexes.embedding) ||
    !episode.indexes.embedding.every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value),
    )
  ) {
    return null;
  }

  return episode as MemoryEpisode;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Calculates all retrieval scores for one Episode.
 *
 * Returns null when the Episode has no usable embedding.
 */
function scoreEpisode(
  query: PreparedQuery,
  episode: MemoryEpisode,
): EpisodeSearchResult | null {
  const episodeEmbedding =
    episode.indexes?.embedding;

  if (
    !Array.isArray(episodeEmbedding) ||
    episodeEmbedding.length === 0
  ) {
    return null;
  }

  validateEmbeddingDimensions(
    query.semanticQueryEmbedding,
    episodeEmbedding,
    episode.id,
  );

  const episodeKeywords =
    episode.indexes.keywords ?? [];

  const episodeEntities =
    episode.indexes.entities ?? [];

  const semanticQuerySimilarity =
    normalizeCosineSimilarity(
      textSimilarity.compareEmbeddingToEmbedding(
        query.semanticQueryEmbedding,
        episodeEmbedding,
      ),
    );

  const userMessageSimilarity =
    normalizeCosineSimilarity(
      textSimilarity.compareEmbeddingToEmbedding(
        query.userMessageEmbedding,
        episodeEmbedding,
      ),
    );

  const keywordScore = calculateKeywordScore(
    query.keywords,
    episodeKeywords,
  );

  const entityScore = calculateEntityScore(
    query.entities,
    episodeEntities,
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

  return {
    episodeId: episode.id,
    sessionId: episode.sessionId,
    subject: episode.indexes.subject,
    keywords: episodeKeywords,
    entities: episodeEntities,
    score: {
      semanticQuerySimilarity,
      userMessageSimilarity,
      keywordScore,
      entityScore,
      finalScore,
    },
  };
}

/**
 * Converts cosine similarity from -1..1 to 0..1.
 */
function normalizeCosineSimilarity(
  similarity: number,
): number {
  const normalized = (similarity + 1) / 2;

  return clamp(normalized, 0, 1);
}

/**
 * Calculates keyword coverage.
 *
 * Example:
 * Query keywords:   ["python", "ping", "network"]
 * Episode keywords: ["python", "ping"]
 * Score: 2 / 3
 */
function calculateKeywordScore(
  queryKeywords: string[],
  episodeKeywords: string[],
): number {
  if (queryKeywords.length === 0) {
    return 0;
  }

  if (episodeKeywords.length === 0) {
    return 0;
  }

  const episodeKeywordSet = new Set(
    normalizeKeywords(episodeKeywords),
  );

  let matchedKeywords = 0;

  for (const queryKeyword of queryKeywords) {
    if (episodeKeywordSet.has(queryKeyword)) {
      matchedKeywords += 1;
      continue;
    }

    const partialMatch = [
      ...episodeKeywordSet,
    ].some(
      (episodeKeyword) =>
        episodeKeyword.includes(queryKeyword) ||
        queryKeyword.includes(episodeKeyword),
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
 * Similar or partial name:            0.5
 * No match:                           0.0
 */
function calculateEntityScore(
  queryEntities: NormalizedEntity[],
  episodeEntities: WindowEntity[],
): number {
  if (queryEntities.length === 0) {
    return 0;
  }

  if (episodeEntities.length === 0) {
    return 0;
  }

  let totalScore = 0;

  for (const queryEntity of queryEntities) {
    let bestMatchScore = 0;

    for (const episodeEntity of episodeEntities) {
      const episodeNormalizedName =
        normalizeText(
          episodeEntity.normalized ||
            episodeEntity.text,
        );

      const nameMatches =
        queryEntity.normalizedName ===
        episodeNormalizedName;

      const typeMatches =
        queryEntity.type ===
        normalizeText(episodeEntity.type);

      if (nameMatches && typeMatches) {
        bestMatchScore = Math.max(
          bestMatchScore,
          1,
        );
        continue;
      }

      if (nameMatches) {
        bestMatchScore = Math.max(
          bestMatchScore,
          0.8,
        );
        continue;
      }

      const partialNameMatch =
        episodeNormalizedName.includes(
          queryEntity.normalizedName,
        ) ||
        queryEntity.normalizedName.includes(
          episodeNormalizedName,
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
 * Calculates a weighted score while ignoring unavailable signals.
 *
 * If the query has no entities, the entity weight is removed and
 * the remaining active weights are normalized automatically.
 */
function calculateFinalScore(
  components: ScoreComponent[],
): number {
  const activeComponents = components.filter(
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

  return [...new Set(normalizedKeywords)];
}

function normalizeEntities(
  entities: MemoryQueryEntity[],
): NormalizedEntity[] {
  if (!Array.isArray(entities)) {
    return [];
  }

  return entities
    .map((entity) => ({
      name:
        typeof entity?.name === "string"
          ? entity.name.trim()
          : "",
      normalizedName: normalizeText(
        (entity?.normalizedName ||
          entity?.name) ??
          "",
      ),
      type:
        typeof entity?.type === "string"
          ? normalizeText(entity.type)
          : "",
    }))
    .filter(
      (entity) =>
        entity.normalizedName.length > 0,
    );
}

/* -------------------------------------------------------------------------- */
/* Validation Helpers                                                         */
/* -------------------------------------------------------------------------- */

function validateEmbeddingDimensions(
  queryEmbedding: number[],
  episodeEmbedding: number[],
  episodeId: string,
): void {
  if (
    queryEmbedding.length !==
    episodeEmbedding.length
  ) {
    throw new Error(
      [
        `Embedding dimension mismatch for episode "${episodeId}".`,
        `Query dimension: ${queryEmbedding.length}.`,
        `Episode dimension: ${episodeEmbedding.length}.`,
        `Both embeddings must be generated with the same model.`,
      ].join(" "),
    );
  }
}
