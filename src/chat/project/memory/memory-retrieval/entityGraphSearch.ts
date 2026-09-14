// entityGraphSearch.ts

import type Database from "@tauri-apps/plugin-sql";

import {
  textSimilarity,
} from "../../../../services/ai/tools/textSimilarity";

import { clamp } from "../window/helpers";

import type {
  MemoryWindow,
} from "../window/types";

import { databaseManager } from "../storage/databaseManager";

import {
  getGraphDatabaseConnection,
  useWindowGraphDatabase,
} from "../window/windowGraphIndexer";

/*
 * The Window storage layer (windowStorage.ts) defines "window" as the
 * record type of the full serialized MemoryWindow records. These
 * records contain the original Turns including their stored semantic
 * embeddings, which the graph search reuses instead of regenerating
 * them.
 */
const WINDOW_RECORD_TYPE = "window";

/* -------------------------------------------------------------------------- */
/* Console Logging                                                            */
/* -------------------------------------------------------------------------- */

const ENTITY_GRAPH_SEARCH_LOG_PREFIX =
  "[EntityGraphSearch]";

/**
 * Set to false to silence all entity graph search logs.
 */
const ENTITY_GRAPH_SEARCH_LOGGING_ENABLED =
  true;

function logGraphSearch(
  message: string,
): void {
  if (
    ENTITY_GRAPH_SEARCH_LOGGING_ENABLED
  ) {
    console.info(
      `${ENTITY_GRAPH_SEARCH_LOG_PREFIX} ${message}`,
    );
  }
}

function logGraphSearchWarning(
  message: string,
): void {
  if (
    ENTITY_GRAPH_SEARCH_LOGGING_ENABLED
  ) {
    console.warn(
      `${ENTITY_GRAPH_SEARCH_LOG_PREFIX} ${message}`,
    );
  }
}

function logGraphSearchError(
  message: string,
  error: unknown,
): void {
  if (
    ENTITY_GRAPH_SEARCH_LOGGING_ENABLED
  ) {
    console.error(
      `${ENTITY_GRAPH_SEARCH_LOG_PREFIX} ${message}`,
      error,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Tuning Constants                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Weight of the query-entity coverage inside the final Turn score.
 */
const ENTITY_WEIGHT = 0.6;

/**
 * Weight of the user-message / Turn semantic similarity inside the
 * final Turn score.
 */
const SEMANTIC_WEIGHT = 0.4;

/**
 * Minimum raw cosine similarity required between a selected primary
 * Turn and its immediate previous/next Turn for the neighbor to be
 * included. Strictly greater than: a Turn with exactly this score is
 * NOT included.
 */
const NEIGHBOR_SIMILARITY_THRESHOLD = 0.6;

/**
 * Maximum number of primary Turns returned per search.
 */
const MAX_PRIMARY_TURNS = 5;

/**
 * Maximum number of Turn embeddings generated in parallel when stored
 * embeddings are missing.
 */
const EMBEDDING_GENERATION_CONCURRENCY = 4;

/**
 * Maximum number of SQL parameters per batched "IN (...)" query.
 */
const SQL_PARAMETER_BATCH_SIZE = 100;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One Turn that mentions a searched entity.
 */
export interface GraphRelatedTurn {
  turnId: string;

  windowId: string | null;

  /** Position of the Turn inside its Window. */
  position: number | null;

  userMessage: string;

  agentResponse: string;

  subject: string | null;

  keywords: string[];

  createdAt: string | null;

  /** Original surface form of the mention in this Turn. */
  mentionText: string;
}

/**
 * Debugging / tuning metadata of one primary Turn.
 */
export interface GraphTurnScore {
  /** Graph entity node ids of the matched entities connected to the Turn. */
  matchedEntityIds: string[];

  /**
   * |M(t)|: number of unique matched query entities connected to the
   * Turn.
   */
  matchedEntityCount: number;

  /** |Q|: number of unique query entities matched to graph entities. */
  totalQueryEntityCount: number;

  /** |M(t)| / |Q|, clamped to [0, 1]. */
  entityScore: number;

  /**
   * Semantic similarity between the user message and the Turn,
   * normalized to [0, 1].
   */
  similarityScore: number;

  /** ENTITY_WEIGHT * entityScore + SEMANTIC_WEIGHT * similarityScore. */
  finalScore: number;
}

/**
 * Why the direction of a neighbor Turn relative to its primary Turn.
 *
 * - "previous": the Turn immediately before the primary Turn.
 * - "next": the Turn immediately after the primary Turn.
 */
export type GraphNeighborDirection =
  | "previous"
  | "next";

/**
 * One Turn of the ranked graph search result: either a primary Turn
 * selected by its final score, or a context-expanding immediate
 * previous/next neighbor of a primary Turn.
 */
export interface GraphRankedTurn extends GraphRelatedTurn {
  /** True when this Turn is one of the top selected primary Turns. */
  isPrimary: boolean;

  /** Scoring metadata. Set for primary Turns, null for neighbors. */
  score: GraphTurnScore | null;

  /** True when this Turn only expands the context of a primary Turn. */
  isNeighbor: boolean;

  /** Turn id of the primary Turn this neighbor belongs to. */
  neighborOfTurnId: string | null;

  /** Neighbor direction relative to the primary Turn. */
  neighborDirection: GraphNeighborDirection | null;

  /**
   * Raw cosine similarity between this neighbor Turn and its primary
   * Turn. Null for primary Turns.
   */
  neighborSimilarity: number | null;
}

/**
 * Result of searching one normalized entity in the graph database.
 */
export interface GraphEntitySearchMatch {
  /** Normalized query string as passed in by the caller. */
  query: string;

  /** True when an entity node with this normalized value exists. */
  found: boolean;

  /** Canonical normalized value stored on the graph entity node. */
  normalized: string | null;

  entityType: string | null;

  entityNodeId: string | null;

  /** Number of unique Turns mentioning this entity. */
  mentionCount: number;

  /** Turns connected to this entity (unranked, one entry per Turn). */
  relatedTurns: GraphRelatedTurn[];
}

export interface GraphEntitySearchResult {
  /** One entry per queried entity, in query order. */
  matches: GraphEntitySearchMatch[];

  foundCount: number;

  totalMentionCount: number;

  /**
   * Ranked Turns: the top primary Turns ordered by final score, each
   * optionally expanded with its immediate previous/next neighbors
   * (previous -> primary -> next). Every turnId appears at most once.
   */
  rankedTurns: GraphRankedTurn[];
}

/* -------------------------------------------------------------------------- */
/* Row Types                                                                  */
/* -------------------------------------------------------------------------- */

interface GraphNodeRow {
  node_id: string;
  node_type: string;
  source_id: string | null;
  window_id: string | null;
  data: string;
}

interface GraphEdgeRow {
  edge_id: string;
  edge_type: string;
  from_node: string;
  to_node: string;
  window_id: string | null;
  data: string;
}

interface EntityNodeData {
  normalized?: unknown;
  entityType?: unknown;
  text?: unknown;
}

interface TurnNodeData {
  turnId?: unknown;
  windowId?: unknown;
  position?: unknown;
  userMessage?: unknown;
  agentResponse?: unknown;
  subject?: unknown;
  keywords?: unknown;
  createdAt?: unknown;
}

interface MentionEdgeData {
  windowId?: unknown;
  mentionText?: unknown;
  normalized?: unknown;
  entityType?: unknown;
}

/* -------------------------------------------------------------------------- */
/* Internal Candidate / Scoring Types                                         */
/* -------------------------------------------------------------------------- */

/**
 * One unique candidate Turn connected to at least one matched entity.
 * Candidate Turns are deduplicated by turnId before scoring.
 */
interface CandidateTurn {
  turnId: string;

  turnNodeId: string;

  windowId: string | null;

  position: number | null;

  userMessage: string;

  agentResponse: string;

  subject: string | null;

  keywords: string[];

  createdAt: string | null;

  /**
   * Unique matched query entities (canonical normalized values) that
   * this Turn is connected to: M(t).
   */
  matchedNormalizedEntities: Set<string>;

  /**
   * Graph entity node ids of the matched entities connected to this
   * Turn (debugging metadata).
   */
  matchedEntityNodeIds: Set<string>;
}

/**
 * One unique candidate Turn with its final ranking score.
 */
interface ScoredTurn {
  turn: CandidateTurn;

  /** |Q|: unique matched query entities of the whole request. */
  totalQueryEntityCount: number;

  entityScore: number;

  similarityScore: number;

  finalScore: number;
}

/**
 * A neighbor candidate with its raw similarity towards its primary
 * Turn.
 */
interface NeighborCandidate {
  turn: CandidateTurn;

  similarity: number;
}

/**
 * One primary Turn with its optional immediate previous/next
 * neighbors.
 */
interface PrimaryGroup {
  primary: ScoredTurn;

  previous: NeighborCandidate | null;

  next: NeighborCandidate | null;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Searches the graph database (memory-graph.db) for the given canonical
 * normalized entities and ranks every Turn connected to a matched
 * entity.
 *
 * The input is the return value of extractEntities(...) in
 * extractMessageEntities.ts: an array of canonical normalized strings.
 *
 * Ranking strategy:
 *
 * 1. Match the query entities against the entity nodes that actually
 *    exist in the graph database (Q = unique matched normalized values).
 * 2. Collect every Turn connected to at least one matched entity node
 *    and deduplicate the candidates by turnId.
 * 3. Score every unique candidate Turn:
 *
 *      entityScore     = |M(t)| / |Q|
 *      similarityScore = cosine(userMessageEmbedding, turnEmbedding)
 *                        normalized to [0, 1]
 *      finalScore      = 0.60 * entityScore + 0.40 * similarityScore
 *
 *    where M(t) is the set of unique matched query entities connected
 *    to the Turn.
 *
 * 4. Return the top MAX_PRIMARY_TURNS primary Turns and, per primary
 *    Turn, its immediate previous/next Turn of the SAME Window when the
 *    raw cosine similarity between the two Turn embeddings is strictly
 *    greater than NEIGHBOR_SIMILARITY_THRESHOLD.
 *
 * The user-message embedding is generated exactly once per search.
 * Stored Turn embeddings from the Window records are reused whenever
 * available; missing Turn embeddings are generated with bounded
 * concurrency and cached by turnId for the whole request.
 *
 * The search always runs against the graph database of the
 * user-selected project folder:
 *
 *   <projectPath>/.mocu/storage/memory-graph.db
 *
 * When a projectPath is passed, the graph index and the Window record
 * database are explicitly pointed at that project folder first. When
 * no projectPath is given, the currently active databases are searched
 * (previous behavior).
 */
export async function searchGraphEntities(
  normalizedEntities: string[],
  userMessage: string,
  projectPath?: string | null,
): Promise<GraphEntitySearchResult> {
  if (
    !Array.isArray(normalizedEntities) ||
    normalizedEntities.length === 0
  ) {
    logGraphSearch(
      "searchGraphEntities: empty input, returning no matches",
    );

    return createEmptyResult();
  }

  /*
   * The user message is only used for the semantic similarity score.
   * An empty message degrades the search to pure entity coverage
   * (similarityScore = 0) instead of failing.
   */
  const trimmedUserMessage =
    typeof userMessage === "string"
      ? userMessage.trim()
      : "";

  const uniqueQueries =
    dedupeNormalizedEntities(
      normalizedEntities,
    );

  if (uniqueQueries.length === 0) {
    logGraphSearch(
      "searchGraphEntities: no valid entity strings after deduplication, returning no matches",
    );

    return createEmptyResult();
  }

  logGraphSearch(
    `searchGraphEntities: start (${uniqueQueries.length} unique entity/ies): ${JSON.stringify(uniqueQueries)}`,
  );

  try {
    /*
     * Point the graph index at the SQLite database of the
     * user-selected project folder before opening the connection:
     *
     *   <projectPath>/.mocu/storage/memory-graph.db
     *
     * Without a projectPath the currently active graph database is
     * used unchanged.
     */
    await pointGraphDatabaseAtProject(
      projectPath,
    );

    /*
     * Point the Window record database at the same project folder so
     * the stored Turn embeddings are read from the project's
     * Window records and not from the global database.
     */
    await pointWindowRecordsAtProject(
      projectPath,
    );

    const database =
      await getGraphDatabaseConnection();

    const entityNodesByNormalized =
      await loadEntityNodesByNormalized(
        database,
      );

    logGraphSearch(
      `searchGraphEntities: ${entityNodesByNormalized.size} entity node(s) loaded from graph database`,
    );

    /*
     * Match every query entity against the entity nodes that actually
     * exist in the graph database. Q = unique matched normalized
     * values.
     */
    const matches:
      GraphEntitySearchMatch[] =
      [];

    const matchedEntityNodeIds =
      new Set<string>();

    const matchedNormalizedQueries =
      new Set<string>();

    let totalMentionCount = 0;

    for (const query of uniqueQueries) {
      const normalizedQuery =
        normalizeSearchEntity(query);

      const entityNodes =
        entityNodesByNormalized.get(
          normalizedQuery,
        );

      if (
        !entityNodes ||
        entityNodes.length === 0
      ) {
        logGraphSearch(
          `searchGraphEntities: "${normalizedQuery}" not found in graph`,
        );

        matches.push(
          createNotFoundMatch(query),
        );

        continue;
      }

      matchedNormalizedQueries.add(
        normalizedQuery,
      );

      for (
        const entityNode of entityNodes
      ) {
        matchedEntityNodeIds.add(
          entityNode.node_id,
        );
      }

      logGraphSearch(
        `searchGraphEntities: "${normalizedQuery}" found as ${entityNodes.length} entity node(s)`,
      );
    }

    /*
     * One match per typed entity node. The entity node id stays
     * "entity:<type>:<normalized>", so the same normalized value
     * stored under several types produces one match per type.
     */
    for (const query of uniqueQueries) {
      const normalizedQuery =
        normalizeSearchEntity(query);

      const entityNodes =
        entityNodesByNormalized.get(
          normalizedQuery,
        );

      if (
        !entityNodes ||
        entityNodes.length === 0
      ) {
        continue;
      }

      for (const entityNode of entityNodes) {
        const entityData =
          parseJsonEntityData(
            entityNode.data,
          );

        matches.push({
          query,
          found: true,

          normalized: asStringOrNull(
            entityData.normalized,
          ),

          entityType: asStringOrNull(
            entityData.entityType,
          ),

          entityNodeId:
            entityNode.node_id,

          /*
           * Filled in after the mention edges and Turn nodes have
           * been loaded (see below).
           */
          mentionCount: 0,
          relatedTurns: [],
        });
      }
    }

    const foundCount =
      matches.filter(
        (match) => match.found,
      ).length;

    /*
     * Q = set of unique query entities successfully matched to graph
     * entities. Without matched entities there are no graph-based
     * results and no division by zero later.
     */
    const totalQueryEntityCount =
      matchedNormalizedQueries.size;

    const result: GraphEntitySearchResult = {
      matches,
      foundCount,
      totalMentionCount,
      rankedTurns: [],
    };

    if (totalQueryEntityCount === 0) {
      logGraphSearch(
        "searchGraphEntities: no query entity matched an entity node, returning no graph-based results",
      );

      result.totalMentionCount = 0;

      return result;
    }

    /*
     * Collect every TURN_MENTIONS_ENTITY edge pointing at a matched
     * entity node in one batched query, then load all referenced
     * Turn nodes in one batched query. This avoids N+1 queries.
     */
    const mentionEdges =
      await loadMentionEdges(
        database,
        matchedEntityNodeIds,
      );

    const candidateTurns =
      await loadCandidateTurns(
        database,
        mentionEdges,
        matchedNormalizedQueries,
      );

    logGraphSearch(
      `searchGraphEntities: ${candidateTurns.size} unique candidate Turn(s) connected to ${matchedEntityNodeIds.size} matched entity node(s)`,
    );

    if (candidateTurns.size === 0) {
      logGraphSearch(
        "searchGraphEntities: no Turn is connected to a matched entity, returning no graph-based results",
      );

      return result;
    }

    /*
     * Build the unranked per-entity match lists from the already
     * loaded edges (no extra queries).
     */
    totalMentionCount =
      fillMatchRelatedTurns(
        matches,
        mentionEdges,
        candidateTurns,
      );

    result.totalMentionCount =
      totalMentionCount;

    /*
     * Load the stored Turn embeddings of the Window records once and
     * use them as the initial in-request embedding cache.
     */
    const embeddingCache =
      await createEmbeddingCacheFromStoredWindows(
        candidateTurns,
      );

    /*
     * The user-message embedding is generated exactly once per
     * search request. An empty message or a failed embedding
     * degrades the score to pure entity coverage.
     */
    const userMessageEmbedding =
      await resolveUserMessageEmbedding(
        trimmedUserMessage,
      );

    if (!userMessageEmbedding) {
      logGraphSearchWarning(
        "searchGraphEntities: no user-message embedding available, ranking Turns by entity coverage only",
      );
    }

    const scoredTurns = await scoreCandidateTurns(
      candidateTurns,
      matchedNormalizedQueries,
      userMessageEmbedding,
      embeddingCache,
    );

    /*
     * Deterministic order: finalScore desc -> entityScore desc ->
     * similarityScore desc -> turnId asc.
     */
    const rankedTurns =
      sortScoredTurns(scoredTurns);

    const primaryTurns =
      rankedTurns.slice(
        0,
        MAX_PRIMARY_TURNS,
      );

    logGraphSearch(
      `searchGraphEntities: ${primaryTurns.length} primary Turn(s) selected from ${scoredTurns.length} candidate(s)`,
    );

    /*
     * Neighbor expansion runs strictly after the primary Turns have
     * been selected. Neighbors never compete with primary Turns.
     */
    const primaryGroups =
      await expandPrimaryTurnNeighbors(
        database,
        primaryTurns,
        embeddingCache,
      );

    result.rankedTurns =
      flattenPrimaryGroups(
        primaryGroups,
      );

    logGraphSearch(
      `searchGraphEntities: done (${foundCount}/${matches.length} entity/ies found, ${result.rankedTurns.length} ranked Turn/s)`,
    );

    return result;
  } catch (error) {
    logGraphSearchError(
      "searchGraphEntities: failed to search the graph database",
      error,
    );

    return createEmptyResult();
  }
}

/**
 * Convenience wrapper: extracts canonical entities from a user message
 * with extractEntities(...) and immediately searches them in the graph
 * database of the user-selected project folder.
 *
 * @param userMessage The current user message. Also used for the
 * semantic similarity score of the ranked Turns.
 * @param projectPath Folder of the user-selected project. The graph
 * database is read from <projectPath>/.mocu/storage/memory-graph.db.
 * When null or empty, the currently active graph database is used.
 */
export async function searchEntitiesFromMessage(
  userMessage: string,
  projectPath?: string | null,
): Promise<GraphEntitySearchResult> {
  const { extractEntities } =
    await import(
      "./extractMessageEntities"
    );

  const normalizedEntities =
    await extractEntities(userMessage);

  return searchGraphEntities(
    normalizedEntities,
    userMessage,
    projectPath,
  );
}

function createEmptyResult(): GraphEntitySearchResult {
  return {
    matches: [],
    foundCount: 0,
    totalMentionCount: 0,
    rankedTurns: [],
  };
}

function createNotFoundMatch(
  query: string,
): GraphEntitySearchMatch {
  return {
    query,
    found: false,

    normalized: null,
    entityType: null,
    entityNodeId: null,

    mentionCount: 0,
    relatedTurns: [],
  };
}

/**
 * Points the graph index at the SQLite database of the given
 * user-selected project folder before a search runs:
 *
 *   <projectPath>/.mocu/storage/memory-graph.db
 *
 * This mirrors saveProjectMemory(...), which writes every graph node
 * and edge into the same project database file, so the search always
 * reads the project data and never the global database in AppConfig.
 *
 * Empty or null project paths keep the currently active database.
 */
async function pointGraphDatabaseAtProject(
  projectPath: string | null | undefined,
): Promise<void> {
  const normalizedProjectPath =
    projectPath?.trim() ?? "";

  if (!normalizedProjectPath) {
    return;
  }

  const databasePath =
    await useWindowGraphDatabase(
      normalizedProjectPath,
    );

  logGraphSearch(
    `searchGraphEntities: searching the graph database of the selected project folder: ${databasePath}`,
  );
}

/**
 * Points the Window record database at the SQLite database of the
 * given user-selected project folder:
 *
 *   <projectPath>/.mocu/storage/memory.db
 *
 * The stored Turn embeddings live inside the Window records, so they
 * must be read from the same project the graph data belongs to.
 *
 * Empty or null project paths keep the currently active database.
 */
async function pointWindowRecordsAtProject(
  projectPath: string | null | undefined,
): Promise<void> {
  const normalizedProjectPath =
    projectPath?.trim() ?? "";

  if (!normalizedProjectPath) {
    return;
  }

  const databasePath =
    await databaseManager.useProjectDatabase(
      normalizedProjectPath,
    );

  logGraphSearch(
    `searchGraphEntities: reading stored Turn embeddings from the Window records of the selected project folder: ${databasePath}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Graph Reads                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Loads every entity node and indexes it by its normalized value.
 *
 * Entity nodes are stored with node_type = "entity" and a data JSON of:
 *
 * { normalized, entityType, text }
 */
async function loadEntityNodesByNormalized(
  database: Database,
): Promise<
  Map<
    string,
    {
      node_id: string;
      data: string;
    }[]
  >
> {
  const rows =
    await database.select<GraphNodeRow[]>(`
      SELECT
        node_id,
        node_type,
        source_id,
        window_id,
        data
      FROM graph_nodes
      WHERE node_type = 'entity'
    `);

  const index = new Map<
    string,
    {
      node_id: string;
      data: string;
    }[]
  >();

  for (const row of rows) {
    const data = parseJsonEntityData(
      row.data,
    );

    const normalized =
      normalizeSearchEntity(
        data.normalized,
      );

    if (!normalized) {
      continue;
    }

    /*
     * Every typed entity node is kept. The entity identity is
     * "entity:<type>:<normalized>", so the same normalized value can
     * exist once per type and each variant is searched separately.
     */
    const existingNodes =
      index.get(normalized);

    if (existingNodes) {
      existingNodes.push({
        node_id: row.node_id,
        data: row.data,
      });
    } else {
      index.set(normalized, [
        {
          node_id: row.node_id,
          data: row.data,
        },
      ]);
    }
  }

  return index;
}

/**
 * Loads every TURN_MENTIONS_ENTITY edge that points at one of the
 * matched entity nodes.
 *
 * The entity node ids are split into fixed-size batches so a large
 * search never exceeds SQLite's parameter limit.
 */
async function loadMentionEdges(
  database: Database,
  entityNodeIds: Set<string>,
): Promise<GraphEdgeRow[]> {
  const edges: GraphEdgeRow[] = [];

  const nodeIdList = [
    ...entityNodeIds,
  ];

  for (
    let offset = 0;
    offset < nodeIdList.length;
    offset += SQL_PARAMETER_BATCH_SIZE
  ) {
    const batch = nodeIdList.slice(
      offset,
      offset + SQL_PARAMETER_BATCH_SIZE,
    );

    const placeholders = batch
      .map(() => "?")
      .join(", ");

    const rows =
      await database.select<GraphEdgeRow[]>(
        `
          SELECT
            edge_id,
            edge_type,
            from_node,
            to_node,
            window_id,
            data
          FROM graph_edges
          WHERE edge_type = 'TURN_MENTIONS_ENTITY'
            AND to_node IN (${placeholders})
        `,
        batch,
      );

    edges.push(...rows);
  }

  return edges;
}

/**
 * Loads the Turn nodes behind the given mention edges and builds one
 * unique candidate Turn per turnId.
 *
 * The mention edges of a Turn determine which matched query entities
 * the Turn is connected to: M(t). Duplicate edges (the same Turn
 * mentioning the same entity twice) do not increase |M(t)|.
 */
async function loadCandidateTurns(
  database: Database,
  mentionEdges: GraphEdgeRow[],
  matchedNormalizedQueries: Set<string>,
): Promise<Map<string, CandidateTurn>> {
  const turnNodeIds = new Set<string>();

  for (const edge of mentionEdges) {
    turnNodeIds.add(edge.from_node);
  }

  const turnNodesByNodeId =
    await loadTurnNodesByNodeIds(
      database,
      turnNodeIds,
    );

  const candidateTurns = new Map<
    string,
    CandidateTurn
  >();

  for (const edge of mentionEdges) {
    const turnNodeRow =
      turnNodesByNodeId.get(
        edge.from_node,
      );

    if (!turnNodeRow) {
      logGraphSearchWarning(
        `loadCandidateTurns: Turn node "${edge.from_node}" is missing for entity "${edge.to_node}"`,
      );

      continue;
    }

    const turnData =
      parseJsonTurnData(
        turnNodeRow.data,
      );

    const turnId =
      asStringOrNull(turnData.turnId) ??
      stripTurnNodeId(edge.from_node);

    if (!turnId) {
      continue;
    }

    const edgeData =
      parseJsonMentionData(
        edge.data,
      );

    /*
     * Only matched/canonical entity nodes participate in scoring.
     * Extracted entities that were not matched to an entity node are
     * ignored (the edge query already only returned matched nodes).
     */
    const edgeNormalized =
      normalizeSearchEntity(
        edgeData.normalized,
      );

    const candidateTurn =
      candidateTurns.get(turnId);

    if (candidateTurn) {
      /*
       * The Turn is already a candidate: only extend its matched
       * entity sets. The Turn is never scored twice merely because
       * it is connected to multiple entities.
       */
      if (
        matchedNormalizedQueries.has(
          edgeNormalized,
        )
      ) {
        candidateTurn.matchedNormalizedEntities.add(
          edgeNormalized,
        );
      }

      candidateTurn.matchedEntityNodeIds.add(
        edge.to_node,
      );

      continue;
    }

    const turnWindowId =
      asStringOrNull(
        turnData.windowId,
      ) ??
      asStringOrNull(
        turnNodeRow.window_id,
      );

    const newTurn: CandidateTurn = {
      turnId,
      turnNodeId: edge.from_node,

      windowId: turnWindowId,

      position: asNumberOrNull(
        turnData.position,
      ),

      userMessage: asStringOrNull(
        turnData.userMessage,
      ) ?? "",

      agentResponse: asStringOrNull(
        turnData.agentResponse,
      ) ?? "",

      subject: asStringOrNull(
        turnData.subject,
      ),

      keywords: asStringArray(
        turnData.keywords,
      ),

      createdAt: asStringOrNull(
        turnData.createdAt,
      ),

      matchedNormalizedEntities:
        new Set<string>(),

      matchedEntityNodeIds:
        new Set<string>(),
    };

    if (
      matchedNormalizedQueries.has(
        edgeNormalized,
      )
    ) {
      newTurn.matchedNormalizedEntities.add(
        edgeNormalized,
      );
    }

    newTurn.matchedEntityNodeIds.add(
      edge.to_node,
    );

    candidateTurns.set(
      turnId,
      newTurn,
    );
  }

  return candidateTurns;
}

/**
 * Loads the given Turn nodes in batched queries and indexes them by
 * node id.
 */
async function loadTurnNodesByNodeIds(
  database: Database,
  turnNodeIds: Set<string>,
): Promise<Map<string, GraphNodeRow>> {
  const turnNodes = new Map<
    string,
    GraphNodeRow
  >();

  const nodeIdList = [...turnNodeIds];

  for (
    let offset = 0;
    offset < nodeIdList.length;
    offset += SQL_PARAMETER_BATCH_SIZE
  ) {
    const batch = nodeIdList.slice(
      offset,
      offset + SQL_PARAMETER_BATCH_SIZE,
    );

    const placeholders = batch
      .map(() => "?")
      .join(", ");

    const rows =
      await database.select<GraphNodeRow[]>(
        `
          SELECT
            node_id,
            node_type,
            source_id,
            window_id,
            data
          FROM graph_nodes
          WHERE node_type = 'turn'
            AND node_id IN (${placeholders})
        `,
        batch,
      );

    for (const row of rows) {
      turnNodes.set(row.node_id, row);
    }
  }

  return turnNodes;
}

/**
 * Loads every Turn node of one Window in a single query and indexes
 * the parsed candidate Turns by their position inside the Window.
 *
 * NEXT_TURN graph edges only link consecutive Turns of the same
 * Window, so the Window is the hard boundary of the neighbor
 * expansion: Turns of other Windows, sessions, or projects can never
 * be loaded by this query.
 */
async function loadWindowTurnsByPosition(
  database: Database,
  windowId: string,
): Promise<Map<number, CandidateTurn>> {
  const rows =
    await database.select<GraphNodeRow[]>(
      `
        SELECT
          node_id,
          node_type,
          source_id,
          window_id,
          data
        FROM graph_nodes
        WHERE node_type = 'turn'
          AND window_id = ?
      `,
      [windowId],
    );

  const turnsByPosition = new Map<
    number,
    CandidateTurn
  >();

  for (const row of rows) {
    const turnData =
      parseJsonTurnData(row.data);

    const turnId =
      asStringOrNull(turnData.turnId) ??
      stripTurnNodeId(row.node_id);

    const position = asNumberOrNull(
      turnData.position,
    );

    if (!turnId || position === null) {
      continue;
    }

    turnsByPosition.set(position, {
      turnId,
      turnNodeId: row.node_id,

      windowId:
        asStringOrNull(
          turnData.windowId,
        ) ??
        asStringOrNull(row.window_id),

      position,

      userMessage: asStringOrNull(
        turnData.userMessage,
      ) ?? "",

      agentResponse: asStringOrNull(
        turnData.agentResponse,
      ) ?? "",

      subject: asStringOrNull(
        turnData.subject,
      ),

      keywords: asStringArray(
        turnData.keywords,
      ),

      createdAt: asStringOrNull(
        turnData.createdAt,
      ),

      matchedNormalizedEntities:
        new Set<string>(),

      matchedEntityNodeIds:
        new Set<string>(),
    });
  }

  return turnsByPosition;
}

/**
 * Fills the unranked per-entity relatedTurns lists of the matches
 * from the already loaded mention edges and candidate Turns.
 *
 * Returns the total mention count: the number of unique Turn/mention
 * combinations across all matched entity nodes.
 */
function fillMatchRelatedTurns(
  matches: GraphEntitySearchMatch[],
  mentionEdges: GraphEdgeRow[],
  candidateTurns: Map<string, CandidateTurn>,
): number {
  /*
   * Index the candidate Turns by graph Turn node id once, so every
   * mention edge resolves in O(1).
   */
  const candidateTurnsByNodeId = new Map<
    string,
    CandidateTurn
  >();

  for (const candidateTurn of candidateTurns.values()) {
    candidateTurnsByNodeId.set(
      candidateTurn.turnNodeId,
      candidateTurn,
    );
  }

  const relatedTurnsByEntityNodeId =
    new Map<
      string,
      GraphRelatedTurn[]
    >();

  for (const edge of mentionEdges) {
    const candidateTurn =
      candidateTurnsByNodeId.get(
        edge.from_node,
      );

    if (!candidateTurn) {
      continue;
    }

    const relatedTurns =
      relatedTurnsByEntityNodeId.get(
        edge.to_node,
      ) ?? [];

    relatedTurnsByEntityNodeId.set(
      edge.to_node,
      relatedTurns,
    );

    /*
     * Deduplicate by turnId per entity node: the same Turn mentioning
     * the same entity twice is listed once (the first mention text
     * wins).
     */
    if (
      relatedTurns.some(
        (turn) =>
          turn.turnId ===
          candidateTurn.turnId,
      )
    ) {
      continue;
    }

    const edgeData =
      parseJsonMentionData(
        edge.data,
      );

    relatedTurns.push({
      turnId: candidateTurn.turnId,

      windowId: candidateTurn.windowId,

      position: candidateTurn.position,

      userMessage:
        candidateTurn.userMessage,

      agentResponse:
        candidateTurn.agentResponse,

      subject: candidateTurn.subject,

      keywords: candidateTurn.keywords,

      createdAt: candidateTurn.createdAt,

      mentionText: asStringOrNull(
        edgeData.mentionText,
      ) ?? "",
    });
  }

  let totalMentionCount = 0;

  for (const match of matches) {
    if (
      !match.found ||
      !match.entityNodeId
    ) {
      continue;
    }

    const relatedTurns =
      relatedTurnsByEntityNodeId.get(
        match.entityNodeId,
      ) ?? [];

    match.relatedTurns = relatedTurns;
    match.mentionCount =
      relatedTurns.length;

    totalMentionCount +=
      relatedTurns.length;
  }

  return totalMentionCount;
}

/* -------------------------------------------------------------------------- */
/* Embeddings                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Builds the initial in-request Turn embedding cache from the stored
 * Turn embeddings of the Window records.
 *
 * Every stored embedding is reused as-is; missing Turns are generated
 * later on demand. Failures of the Window record read never fail the
 * search itself.
 */
async function createEmbeddingCacheFromStoredWindows(
  candidateTurns: Map<string, CandidateTurn>,
): Promise<Map<string, number[] | null>> {
  const embeddingCache = new Map<
    string,
    number[] | null
  >();

  if (candidateTurns.size === 0) {
    return embeddingCache;
  }

  try {
    const windowRecords =
      await databaseManager.getByType<MemoryWindow>(
        WINDOW_RECORD_TYPE,
      );

    for (const record of windowRecords) {
      const turns =
        record.data?.turns;

      if (!Array.isArray(turns)) {
        continue;
      }

      for (const turn of turns) {
        const turnId =
          extractStoredTurnId(turn);

        if (
          !turnId ||
          embeddingCache.has(turnId)
        ) {
          continue;
        }

        const embedding =
          extractStoredTurnEmbedding(
            turn,
          );

        embeddingCache.set(
          turnId,
          embedding,
        );
      }
    }

    logGraphSearch(
      `createEmbeddingCacheFromStoredWindows: ${embeddingCache.size} stored Turn embedding(s) loaded from Window records`,
    );
  } catch (error) {
    logGraphSearchWarning(
      "createEmbeddingCacheFromStoredWindows: stored Turn embeddings could not be read from the Window records; missing Turn embeddings will be generated on demand",
    );

    logGraphSearchError(
      "createEmbeddingCacheFromStoredWindows: Window record read failed",
      error,
    );
  }

  return embeddingCache;
}

/**
 * Extracts the stable Turn id of a stored Turn. The persisted Turn
 * payloads of createTurn carry their generated id, so the id survives
 * the Window serialization.
 */
function extractStoredTurnId(
  turn: unknown,
): string | null {
  if (
    !turn ||
    typeof turn !== "object"
  ) {
    return null;
  }

  const turnId = (turn as { id?: unknown })
    .id;

  if (
    typeof turnId !== "string" ||
    !turnId.trim()
  ) {
    return null;
  }

  return turnId.trim();
}

/**
 * Extracts the stored semantic embedding of a stored Turn.
 *
 * Returns null when the Turn has no usable embedding.
 */
function extractStoredTurnEmbedding(
  turn: unknown,
): number[] | null {
  if (
    !turn ||
    typeof turn !== "object"
  ) {
    return null;
  }

  const indexes = (turn as {
    indexes?: unknown;
  }).indexes;

  if (
    !indexes ||
    typeof indexes !== "object"
  ) {
    return null;
  }

  const embedding = (indexes as {
    embedding?: unknown;
  }).embedding;

  if (!Array.isArray(embedding)) {
    return null;
  }

  const isValidEmbedding =
    embedding.length > 0 &&
    embedding.every(
      (value) =>
        typeof value === "number" &&
        Number.isFinite(value),
    );

  if (!isValidEmbedding) {
    return null;
  }

  return embedding;
}

/**
 * Generates the user-message embedding. Called exactly once per
 * search request.
 *
 * Returns null when the message is empty or the embedding service
 * fails; the search then degrades to pure entity coverage instead of
 * failing.
 */
async function resolveUserMessageEmbedding(
  trimmedUserMessage: string,
): Promise<number[] | null> {
  if (!trimmedUserMessage) {
    return null;
  }

  try {
    return await textSimilarity.embedText(
      trimmedUserMessage,
    );
  } catch (error) {
    logGraphSearchWarning(
      "resolveUserMessageEmbedding: the user-message embedding could not be generated; ranking Turns by entity coverage only",
    );

    logGraphSearchError(
      "resolveUserMessageEmbedding: embedding generation failed",
      error,
    );

    return null;
  }
}

/**
 * Generates every missing Turn embedding with bounded concurrency and
 * caches it by turnId.
 *
 * A Turn whose embedding cannot be generated is cached as null so it
 * is not retried and never fails the whole search.
 */
async function generateMissingTurnEmbeddings(
  turns: CandidateTurn[],
  embeddingCache: Map<string, number[] | null>,
): Promise<void> {
  const pendingEmbeddings: {
    turnId: string;
    text: string;
  }[] = [];

  for (const turn of turns) {
    if (embeddingCache.has(turn.turnId)) {
      continue;
    }

    const text =
      createTurnEmbeddingText(
        turn.userMessage,
        turn.agentResponse,
      );

    if (!text.trim()) {
      embeddingCache.set(
        turn.turnId,
        null,
      );

      continue;
    }

    pendingEmbeddings.push({
      turnId: turn.turnId,
      text,
    });
  }

  if (pendingEmbeddings.length === 0) {
    return;
  }

  logGraphSearch(
    `generateMissingTurnEmbeddings: ${pendingEmbeddings.length} Turn embedding(s) to generate`,
  );

  let cursor = 0;

  const workers = Array.from(
    {
      length: Math.min(
        EMBEDDING_GENERATION_CONCURRENCY,
        pendingEmbeddings.length,
      ),
    },
    async () => {
      while (cursor < pendingEmbeddings.length) {
        const pending =
          pendingEmbeddings[cursor];

        cursor += 1;

        try {
          const embedding =
            await textSimilarity.embedText(
              pending.text,
            );

          embeddingCache.set(
            pending.turnId,
            embedding,
          );
        } catch (error) {
          logGraphSearchWarning(
            `generateMissingTurnEmbeddings: embedding generation failed for Turn "${pending.turnId}"; the Turn is scored without semantic similarity`,
          );

          logGraphSearchError(
            "generateMissingTurnEmbeddings: embedding generation failed",
            error,
          );

          embeddingCache.set(
            pending.turnId,
            null,
          );
        }
      }
    },
  );

  await Promise.all(workers);
}

/**
 * Returns the cached embedding of one Turn, or null when the Turn has
 * no usable embedding.
 */
function getTurnEmbedding(
  turn: CandidateTurn,
  embeddingCache: Map<string, number[] | null>,
): number[] | null {
  const embedding = embeddingCache.get(
    turn.turnId,
  );

  if (
    !embedding ||
    embedding.length === 0
  ) {
    return null;
  }

  return embedding;
}

/**
 * Builds the canonical Turn embedding text.
 *
 * This mirrors createTurnEmbeddingText of createTurn.ts, which is the
 * text every stored Turn embedding was created from, so generated
 * embeddings stay compatible with the stored ones.
 */
function createTurnEmbeddingText(
  userMessage: string,
  agentResponse: string,
): string {
  return [
    "User message:",
    userMessage,
    "",
    "Agent response:",
    agentResponse,
  ].join("\n");
}

/**
 * Compares two embeddings with the project cosine-similarity helper.
 *
 * Returns null instead of throwing when one embedding is missing or
 * the dimensions are incompatible. Both embeddings must come from the
 * same embedding model; incompatible dimensions are treated as an
 * unusable pair.
 */
function compareEmbeddings(
  first: number[] | null,
  second: number[] | null,
  label: string,
): number | null {
  if (!first || !second) {
    return null;
  }

  if (first.length !== second.length) {
    logGraphSearchWarning(
      `compareEmbeddings: ${label} embeddings have incompatible dimensions (${first.length} and ${second.length}); the pair is skipped`,
    );

    return null;
  }

  try {
    return textSimilarity.compareEmbeddingToEmbedding(
      first,
      second,
    );
  } catch (error) {
    logGraphSearchWarning(
      `compareEmbeddings: ${label} similarity comparison failed; the pair is skipped`,
    );

    logGraphSearchError(
      "compareEmbeddings: similarity comparison failed",
      error,
    );

    return null;
  }
}

/**
 * Normalizes a cosine similarity from [-1, 1] to [0, 1].
 *
 * This mirrors normalizeCosineSimilarity of windowSearchEngine.ts so
 * all retrieval engines share the same similarity convention.
 */
function normalizeSimilarityToUnitRange(
  similarity: number,
): number {
  if (!Number.isFinite(similarity)) {
    return 0;
  }

  const normalized = (similarity + 1) / 2;

  return clamp(normalized, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Calculates the query-entity coverage of one candidate Turn:
 *
 *   entityScore(t) = |M(t)| / |Q|
 *
 * The sets are unique entity values, so duplicate mention edges never
 * increase the score. The result is clamped to [0, 1]; |Q| = 0
 * returns 0 instead of dividing by zero.
 */
function calculateEntityScore(
  matchedEntityCount: number,
  totalQueryEntityCount: number,
): number {
  if (totalQueryEntityCount <= 0) {
    return 0;
  }

  return clamp(
    matchedEntityCount /
      totalQueryEntityCount,
    0,
    1,
  );
}

/**
 * Scores every unique candidate Turn exactly once:
 *
 *   finalScore = 0.60 * entityScore + 0.40 * similarityScore
 *
 * The user-message embedding was generated once for the whole
 * request; Turn embeddings come from the in-request cache (stored
 * embeddings first, generated embeddings second).
 */
async function scoreCandidateTurns(
  candidateTurns: Map<string, CandidateTurn>,
  matchedNormalizedQueries: Set<string>,
  userMessageEmbedding: number[] | null,
  embeddingCache: Map<string, number[] | null>,
): Promise<ScoredTurn[]> {
  const candidates = [
    ...candidateTurns.values(),
  ];

  /*
   * Turn embeddings are only needed when a user-message embedding
   * exists to compare them against. Generate missing embeddings once,
   * with bounded concurrency, before any comparison runs.
   */
  if (userMessageEmbedding) {
    await generateMissingTurnEmbeddings(
      candidates,
      embeddingCache,
    );
  }

  const scoredTurns: ScoredTurn[] = [];

  for (const turn of candidates) {
    const matchedEntityCount =
      turn.matchedNormalizedEntities.size;

    const entityScore =
      calculateEntityScore(
        matchedEntityCount,
        matchedNormalizedQueries.size,
      );

    const turnEmbedding = getTurnEmbedding(
      turn,
      embeddingCache,
    );

    const rawSimilarity =
      compareEmbeddings(
        userMessageEmbedding,
        turnEmbedding,
        `Turn "${turn.turnId}"`,
      );

    /*
     * A Turn without a usable embedding is scored with similarity
     * 0 instead of failing the whole search.
     */
    const similarityScore =
      rawSimilarity === null
        ? 0
        : normalizeSimilarityToUnitRange(
            rawSimilarity,
          );

    const finalScore =
      ENTITY_WEIGHT * entityScore +
      SEMANTIC_WEIGHT * similarityScore;

    scoredTurns.push({
      turn,
      totalQueryEntityCount:
        matchedNormalizedQueries.size,
      entityScore,
      similarityScore,
      finalScore,
    });
  }

  return scoredTurns;
}

/**
 * Sorts the scored candidate Turns deterministically:
 *
 * 1. finalScore descending
 * 2. entityScore descending
 * 3. similarityScore descending
 * 4. turnId ascending (stable final tie-breaker)
 */
function sortScoredTurns(
  scoredTurns: ScoredTurn[],
): ScoredTurn[] {
  return scoredTurns.sort(
    (first, second) => {
      if (
        second.finalScore !==
        first.finalScore
      ) {
        return (
          second.finalScore -
          first.finalScore
        );
      }

      if (
        second.entityScore !==
        first.entityScore
      ) {
        return (
          second.entityScore -
          first.entityScore
        );
      }

      if (
        second.similarityScore !==
        first.similarityScore
      ) {
        return (
          second.similarityScore -
          first.similarityScore
        );
      }

      return first.turn.turnId.localeCompare(
        second.turn.turnId,
      );
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Neighbor Expansion                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Expands every selected primary Turn with its immediate previous and
 * next Turn.
 *
 * Rules:
 *
 * - The expansion runs strictly after the primary Turns have been
 *   selected, so neighbors never compete with or replace primary
 *   Turns.
 * - A neighbor must belong to the same Window (and therefore the same
 *   session/project) as its primary Turn. The Window turn query can
 *   never return Turns of another Window.
 * - The neighbor similarity compares the neighbor Turn embedding with
 *   the PRIMARY Turn embedding (not with the user-message embedding).
 * - The neighbor is included only when the raw cosine similarity is
 *   strictly greater than NEIGHBOR_SIMILARITY_THRESHOLD.
 * - Only immediate neighbors are used; neighbors of neighbors are
 *   never expanded.
 * - All Turn embeddings come from the shared in-request cache, so no
 *   Turn embedding is computed twice.
 */
async function expandPrimaryTurnNeighbors(
  database: Database,
  primaryTurns: ScoredTurn[],
  embeddingCache: Map<string, number[] | null>,
): Promise<PrimaryGroup[]> {
  const primaryGroups: PrimaryGroup[] =
    primaryTurns.map((primary) => ({
      primary,
      previous: null,
      next: null,
    }));

  /*
   * Load all Turns of the affected Windows once (one query per
   * Window) and index them by position.
   */
  const windowIds = new Set<string>();

  for (const group of primaryGroups) {
    const windowId =
      group.primary.turn.windowId;

    if (
      windowId &&
      group.primary.turn.position !== null
    ) {
      windowIds.add(windowId);
    }
  }

  const windowTurnsByPosition =
    new Map<
      string,
      Map<number, CandidateTurn>
    >();

  for (const windowId of windowIds) {
    const turnsByPosition =
      await loadWindowTurnsByPosition(
        database,
        windowId,
      );

    windowTurnsByPosition.set(
      windowId,
      turnsByPosition,
    );
  }

  /*
   * Collect the immediate previous/next neighbor candidates per
   * primary Turn before any embedding is generated, so missing
   * neighbor embeddings are generated exactly once.
   */
  interface PendingNeighborComparison {
    groupIndex: number;
    slot: "previous" | "next";
    neighbor: CandidateTurn;
    primaryEmbedding: number[];
  }

  const pendingComparisons: PendingNeighborComparison[] =
    [];

  for (
    let groupIndex = 0;
    groupIndex < primaryGroups.length;
    groupIndex += 1
  ) {
    const group = primaryGroups[groupIndex];

    const primaryTurn = group.primary.turn;

    const primaryEmbedding = getTurnEmbedding(
      group.primary.turn,
      embeddingCache,
    );

    if (!primaryEmbedding) {
      logGraphSearchWarning(
        `expandPrimaryTurnNeighbors: no usable embedding for primary Turn "${primaryTurn.turnId}"; its neighbors are skipped`,
      );

      continue;
    }

    if (
      primaryTurn.windowId === null ||
      primaryTurn.position === null
    ) {
      continue;
    }

    const turnsByPosition =
      windowTurnsByPosition.get(
        primaryTurn.windowId,
      );

    if (!turnsByPosition) {
      continue;
    }

    const slots: {
      slot: "previous" | "next";
      position: number;
    }[] = [
      {
        slot: "previous",
        position:
          primaryTurn.position - 1,
      },
      {
        slot: "next",
        position:
          primaryTurn.position + 1,
      },
    ];

    for (const { slot, position } of slots) {
      const neighbor =
        turnsByPosition.get(position);

      if (!neighbor) {
        continue;
      }

      /*
       * Never cross Window boundaries (defensive double check).
       */
      if (neighbor.windowId !== primaryTurn.windowId) {
        continue;
      }

      pendingComparisons.push({
        groupIndex,
        slot,
        neighbor,
        primaryEmbedding,
      });
    }
  }

  /*
   * Neighbor embeddings reuse the shared cache; missing ones are
   * generated once with bounded concurrency.
   */
  if (pendingComparisons.length > 0) {
    await generateMissingTurnEmbeddings(
      pendingComparisons.map(
        (comparison) => comparison.neighbor,
      ),
      embeddingCache,
    );
  }

  /*
   * Claim map for deduplication: every turnId may appear at most once
   * in the whole result. Primary Turns always win over neighbor
   * copies; a Turn that qualifies as a neighbor of several primary
   * Turns keeps the relationship with the highest similarity.
   */
  const neighborClaims = new Map<
    string,
    {
      groupIndex: number;
      slot: "previous" | "next";
      similarity: number;
    }
  >();

  const primaryTurnIds = new Set(
    primaryTurns.map(
      (primary) => primary.turn.turnId,
    ),
  );

  for (const comparison of pendingComparisons) {
    const neighborTurnId =
      comparison.neighbor.turnId;

    /*
     * A primary Turn is never demoted to a neighbor copy.
     */
    if (primaryTurnIds.has(neighborTurnId)) {
      continue;
    }

    const neighborEmbedding = getTurnEmbedding(
      comparison.neighbor,
      embeddingCache,
    );

    const similarity = compareEmbeddings(
      comparison.primaryEmbedding,
      neighborEmbedding,
      `neighbor "${neighborTurnId}"`,
    );

    if (similarity === null) {
      continue;
    }

    /*
     * Strictly greater than the threshold: a Turn with exactly
     * NEIGHBOR_SIMILARITY_THRESHOLD is NOT included.
     */
    if (
      similarity <=
      NEIGHBOR_SIMILARITY_THRESHOLD
    ) {
      continue;
    }

    const existingClaim =
      neighborClaims.get(neighborTurnId);

    if (existingClaim) {
      if (
        similarity <=
        existingClaim.similarity
      ) {
        continue;
      }

      /*
       * The better relationship wins: remove the weaker neighbor
       * copy from its previous group.
       */
      const previousGroup =
        primaryGroups[
          existingClaim.groupIndex
        ];

      if (
        previousGroup &&
        previousGroup[
          existingClaim.slot
        ]?.turn.turnId === neighborTurnId
      ) {
        previousGroup[
          existingClaim.slot
        ] = null;
      }
    }

    neighborClaims.set(neighborTurnId, {
      groupIndex: comparison.groupIndex,
      slot: comparison.slot,
      similarity,
    });

    primaryGroups[
      comparison.groupIndex
    ][comparison.slot] = {
      turn: comparison.neighbor,
      similarity,
    };
  }

  return primaryGroups;
}

/**
 * Flattens the primary groups into the context-friendly result order:
 *
 *   [previous neighbor -> primary Turn -> next neighbor] per group,
 *
 * with the groups ordered by the primary final-score ranking. Every
 * turnId appears at most once because the neighbor expansion already
 * deduplicated neighbor copies across groups.
 */
function flattenPrimaryGroups(
  primaryGroups: PrimaryGroup[],
): GraphRankedTurn[] {
  const rankedTurns: GraphRankedTurn[] =
    [];

  for (const group of primaryGroups) {
    const primaryTurn = group.primary.turn;

    for (const neighbor of [
      group.previous,
      group.next,
    ]) {
      if (!neighbor) {
        continue;
      }

      rankedTurns.push({
        turnId: neighbor.turn.turnId,

        windowId: neighbor.turn.windowId,

        position: neighbor.turn.position,

        userMessage:
          neighbor.turn.userMessage,

        agentResponse:
          neighbor.turn.agentResponse,

        subject: neighbor.turn.subject,

        keywords: neighbor.turn.keywords,

        createdAt: neighbor.turn.createdAt,

        mentionText: "",

        isPrimary: false,

        score: null,

        isNeighbor: true,

        neighborOfTurnId:
          primaryTurn.turnId,

        neighborDirection:
          neighbor === group.previous
            ? "previous"
            : "next",

        neighborSimilarity:
          neighbor.similarity,
      });
    }

    const matchedEntityIds = [
      ...primaryTurn.matchedEntityNodeIds,
    ];

    rankedTurns.push({
      turnId: primaryTurn.turnId,

      windowId: primaryTurn.windowId,

      position: primaryTurn.position,

      userMessage:
        primaryTurn.userMessage,

      agentResponse:
        primaryTurn.agentResponse,

      subject: primaryTurn.subject,

      keywords: primaryTurn.keywords,

      createdAt: primaryTurn.createdAt,

      mentionText: "",

      isPrimary: true,

      score: {
        matchedEntityIds,

        matchedEntityCount:
          primaryTurn
            .matchedNormalizedEntities
            .size,

        totalQueryEntityCount:
          group.primary
            .totalQueryEntityCount,

        entityScore:
          group.primary.entityScore,

        similarityScore:
          group.primary.similarityScore,

        finalScore:
          group.primary.finalScore,
      },

      isNeighbor: false,

      neighborOfTurnId: null,

      neighborDirection: null,

      neighborSimilarity: null,
    });
  }

  return rankedTurns;
}

/* -------------------------------------------------------------------------- */
/* Input Helpers                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Deduplicates the queried entity strings by their canonical
 * normalized value, preserving the first-occurrence order.
 */
function dedupeNormalizedEntities(
  normalizedEntities: string[],
): string[] {
  const uniqueQueries: string[] = [];

  const seen = new Set<string>();

  for (const entity of normalizedEntities) {
    if (typeof entity !== "string") {
      continue;
    }

    const normalizedQuery =
      normalizeSearchEntity(entity);

    if (
      !normalizedQuery ||
      seen.has(normalizedQuery)
    ) {
      continue;
    }

    seen.add(normalizedQuery);

    uniqueQueries.push(
      normalizedQuery,
    );
  }

  return uniqueQueries;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes an entity string for comparison, mirroring the
 * normalization used when entity nodes were created.
 */
function normalizeSearchEntity(
  value: unknown,
): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseJsonEntityData(
  payload: string,
): EntityNodeData {
  return parseJsonObject<EntityNodeData>(
    payload,
  );
}

function parseJsonTurnData(
  payload: string,
): TurnNodeData {
  return parseJsonObject<TurnNodeData>(
    payload,
  );
}

function parseJsonMentionData(
  payload: string,
): MentionEdgeData {
  return parseJsonObject<MentionEdgeData>(
    payload,
  );
}

function parseJsonObject<
  T extends object,
>(
  payload: string,
): T {
  try {
    const parsed = JSON.parse(
      payload,
    ) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {} as T;
    }

    return parsed as T;
  } catch {
    return {} as T;
  }
}

/**
 * "turn:abc123" -> "abc123"
 */
function stripTurnNodeId(
  turnNodeId: string,
): string {
  return turnNodeId.startsWith(
    "turn:",
  )
    ? turnNodeId.slice("turn:".length)
    : turnNodeId;
}

function asStringOrNull(
  value: unknown,
): string | null {
  return typeof value === "string"
    ? value
    : null;
}

function asNumberOrNull(
  value: unknown,
): number | null {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const numericValue =
      Number(value);

    if (
      Number.isFinite(numericValue)
    ) {
      return numericValue;
    }
  }

  return null;
}

function asStringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string",
  );
}
