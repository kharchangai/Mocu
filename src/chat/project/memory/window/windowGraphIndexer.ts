// window/windowGraphIndexer.ts

/**
 * SQLite graph index for the Window layer.
 *
 * Instead of storing the whole graph as one JSON record, this module
 * maintains its own dedicated SQLite graph database file with two
 * tables:
 *
 * - graph_nodes: one row per Window, Turn, and normalized Entity node
 * - graph_edges: one row per directed relation between nodes
 *
 * Relations created by this index:
 *
 * Window --WINDOW_CONTAINS_TURN--> Turn
 * Turn   --TURN_MENTIONS_ENTITY--> Entity   (normalized + type canonical)
 * Turn   --NEXT_TURN-------------> Next Turn (inside the SAME Window only)
 *
 * Incremental usage:
 *
 * - After createTurn(...) has created a Turn, call indexTurnEntities(turn)
 *   once. It links every normalized Entity of the Turn to the Turn.
 * - After a Turn has been added to a Window (WindowManager.addTurn),
 *   call indexWindowGraph(window) once. It links the previous Turn of
 *   that Window to the new Turn with NEXT_TURN and is safe to re-run.
 *
 * A Turn can never be linked to Turns of another Window: NEXT_TURN edges
 * are only created between consecutive entries of window.turns, and a
 * hard database guard rejects any Turn that is already connected to a
 * different Window.
 *
 * NOTE: databaseManager.ts only exposes the generic "records" table, so
 * this module owns its own SQLite graph database file and its own
 * Tauri SQL connection, exactly like entityMemoryStore does. The file
 * is separate from memory.db and is created on first use.
 */

import Database from "@tauri-apps/plugin-sql";
import { mkdir } from "@tauri-apps/plugin-fs";

import type {
  MemoryWindow,
  Turn,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Database Configuration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Relative SQLite paths used by the Tauri SQL plugin are resolved
 * inside the application's configuration directory.
 *
 * The graph database is a separate SQLite file, next to the other
 * memory databases:
 *
 * AppConfig/storage/memory-graph.db
 */
const DEFAULT_DATABASE_URL =
  "sqlite:storage/memory-graph.db";

/**
 * Location of the graph SQLite database inside a user-selected
 * project folder. The file lives next to the other project storage:
 *
 * <projectPath>/.mocu/storage/memory-graph.db
 */
const PROJECT_STORAGE_DIRECTORY = ".mocu/storage";
const PROJECT_DATABASE_FILE = "memory-graph.db";

/* -------------------------------------------------------------------------- */
/* Console Logging                                                            */
/* -------------------------------------------------------------------------- */

const GRAPH_LOG_PREFIX = "[GraphDB]";

/**
 * Set to false to silence all graph database logs.
 */
const GRAPH_LOGGING_ENABLED = true;

function logGraph(message: string): void {
  if (GRAPH_LOGGING_ENABLED) {
    console.info(
      `${GRAPH_LOG_PREFIX} ${message}`,
    );
  }
}

function logGraphWarning(
  message: string,
): void {
  if (GRAPH_LOGGING_ENABLED) {
    console.warn(
      `${GRAPH_LOG_PREFIX} ${message}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type WindowGraphNodeType =
  | "window"
  | "turn"
  | "entity";

export type WindowGraphEdgeType =
  | "WINDOW_CONTAINS_TURN"
  | "TURN_MENTIONS_ENTITY"
  | "NEXT_TURN";

export interface WindowGraphNode {
  /**
   * Namespaced graph identifier.
   *
   * Examples:
   * - window:window-id
   * - turn:turn-id
   * - entity:technology:sqlite
   */
  id: string;

  type: WindowGraphNodeType;

  /**
   * Original database identifier when one exists.
   */
  sourceId?: string;

  data: Record<string, unknown>;
}

export interface WindowGraphEdge {
  /**
   * Deterministic ID makes the edge idempotent.
   */
  id: string;

  type: WindowGraphEdgeType;

  from: string;
  to: string;

  data?: Record<string, unknown>;
}

export interface WindowGraph {
  /**
   * Graph ID is stable for the Window.
   */
  id: string;

  windowId: string;

  nodes: WindowGraphNode[];
  edges: WindowGraphEdge[];

  createdAt: string;
  updatedAt: string;
}

/**
 * A Window graph read back from the SQLite graph tables.
 */
export interface StoredWindowGraph {
  graphId: string;
  windowId: string;

  nodes: WindowGraphNode[];
  edges: WindowGraphEdge[];
}

export interface IndexWindowGraphResult {
  graphId: string;
  graph: WindowGraph;

  nodeCount: number;
  edgeCount: number;

  windowNodeCount: number;
  turnNodeCount: number;
  entityNodeCount: number;

  containsEdgeCount: number;
  mentionEdgeCount: number;
  nextTurnEdgeCount: number;
}

export interface IndexTurnEntitiesResult {
  turnNodeId: string;
  turnNode: WindowGraphNode;

  entityNodeCount: number;
  mentionEdgeCount: number;
}

/* -------------------------------------------------------------------------- */
/* SQLite Graph Schema                                                        */
/* -------------------------------------------------------------------------- */

const GRAPH_NODES_TABLE = "graph_nodes";
const GRAPH_EDGES_TABLE = "graph_edges";

const CREATE_GRAPH_NODES_TABLE = `
  CREATE TABLE IF NOT EXISTS ${GRAPH_NODES_TABLE} (
    node_id TEXT PRIMARY KEY NOT NULL,
    node_type TEXT NOT NULL,
    source_id TEXT,
    window_id TEXT,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_GRAPH_EDGES_TABLE = `
  CREATE TABLE IF NOT EXISTS ${GRAPH_EDGES_TABLE} (
    edge_id TEXT PRIMARY KEY NOT NULL,
    edge_type TEXT NOT NULL,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    window_id TEXT,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const GRAPH_SCHEMA_STATEMENTS = [
  CREATE_GRAPH_NODES_TABLE,

  `
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_type
    ON ${GRAPH_NODES_TABLE}(node_type)
  `,

  `
    CREATE INDEX IF NOT EXISTS idx_graph_nodes_window
    ON ${GRAPH_NODES_TABLE}(window_id)
  `,

  CREATE_GRAPH_EDGES_TABLE,

  `
    CREATE INDEX IF NOT EXISTS idx_graph_edges_type
    ON ${GRAPH_EDGES_TABLE}(edge_type)
  `,

  `
    CREATE INDEX IF NOT EXISTS idx_graph_edges_from
    ON ${GRAPH_EDGES_TABLE}(from_node)
  `,

  `
    CREATE INDEX IF NOT EXISTS idx_graph_edges_to
    ON ${GRAPH_EDGES_TABLE}(to_node)
  `,

  `
    CREATE INDEX IF NOT EXISTS idx_graph_edges_window
    ON ${GRAPH_EDGES_TABLE}(window_id)
  `,
];

const UPSERT_GRAPH_NODE = `
  INSERT INTO ${GRAPH_NODES_TABLE} (
    node_id,
    node_type,
    source_id,
    window_id,
    data,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(node_id) DO UPDATE SET
    node_type = excluded.node_type,
    source_id = excluded.source_id,

    /*
     * A standalone Turn node is stored without a Window first. When the
     * Window index later claims the Turn, the Window id is filled in.
     * An existing Window id is never overwritten with a new one.
     */
    window_id = COALESCE(
      ${GRAPH_NODES_TABLE}.window_id,
      excluded.window_id
    ),

    data = excluded.data,
    updated_at = excluded.updated_at
`;

const UPSERT_GRAPH_EDGE = `
  INSERT INTO ${GRAPH_EDGES_TABLE} (
    edge_id,
    edge_type,
    from_node,
    to_node,
    window_id,
    data,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(edge_id) DO UPDATE SET
    edge_type = excluded.edge_type,
    from_node = excluded.from_node,
    to_node = excluded.to_node,
    window_id = COALESCE(
      ${GRAPH_EDGES_TABLE}.window_id,
      excluded.window_id
    ),
    data = excluded.data,
    updated_at = excluded.updated_at
`;

/* -------------------------------------------------------------------------- */
/* Graph Database Connection                                                  */
/* -------------------------------------------------------------------------- */

interface GraphNodeRow {
  node_id: string;
  node_type: string;
  source_id: string | null;
  window_id: string | null;
  data: string;
  created_at: number | string;
  updated_at: number | string;
}

interface GraphEdgeRow {
  edge_id: string;
  edge_type: string;
  from_node: string;
  to_node: string;
  window_id: string | null;
  data: string;
  created_at: number | string;
  updated_at: number | string;
}

/**
 * Connection URL of the active graph database.
 *
 * The default points to AppConfig. useWindowGraphDatabase switches it
 * to the database of a user-selected project folder, mirroring the
 * useProjectDatabase methods of databaseManager and entityMemoryStore.
 */
let graphDatabaseUrl: string =
  DEFAULT_DATABASE_URL;

/**
 * Active graph database connection.
 */
let graphDatabase: Database | null = null;

let graphInitializationPromise:
  | Promise<Database>
  | null = null;

/**
 * Serializes all graph database operations.
 */
let graphOperationQueue: Promise<void> =
  Promise.resolve();

function runGraphExclusive<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result =
    graphOperationQueue.then(
      operation,
      operation,
    );

  graphOperationQueue =
    result.then(
      () => undefined,
      () => undefined,
    );

  return result;
}

/**
 * Opens the SQLite graph database once and creates the graph tables.
 */
async function getGraphDatabase(): Promise<Database> {
  if (graphDatabase) {
    return graphDatabase;
  }

  if (!graphInitializationPromise) {
    graphInitializationPromise =
      initializeGraphDatabase().finally(
        () => {
          graphInitializationPromise =
            null;
        },
      );
  }

  return graphInitializationPromise;
}

async function initializeGraphDatabase(): Promise<Database> {
  const database =
    await Database.load(
      graphDatabaseUrl,
    );

  logGraph(
    `graph database opened: ${graphDatabaseUrl}`,
  );

  for (
    let index = 0;
    index < GRAPH_SCHEMA_STATEMENTS.length;
    index += 1
  ) {
    await database.execute(
      GRAPH_SCHEMA_STATEMENTS[index],
    );
  }

  logGraph(
    `graph tables ready: ${GRAPH_NODES_TABLE}, ${GRAPH_EDGES_TABLE}`,
  );

  graphDatabase = database;

  return database;
}

/**
 * Points the graph index at the SQLite database of a user-selected
 * project folder:
 *
 * <projectPath>/.mocu/storage/memory-graph.db
 *
 * Passing null restores the default database in AppConfig. Call this
 * with the same projectPath the user selected so that the graph
 * database file is created in the project storage folder.
 *
 * Returns the file path of the active graph database.
 */
export async function useWindowGraphDatabase(
  projectPath: string | null,
): Promise<string> {
  return runGraphExclusive(() =>
    useWindowGraphDatabaseInternal(
      projectPath,
    ),
  );
}

async function useWindowGraphDatabaseInternal(
  projectPath: string | null,
): Promise<string> {
  const normalizedProjectPath =
    normalizeProjectPath(projectPath);

  if (
    normalizedProjectPath &&
    !isAbsolutePath(normalizedProjectPath)
  ) {
    throw new Error(
      `The project folder path must be absolute: ${normalizedProjectPath}`,
    );
  }

  const targetUrl = normalizedProjectPath
    ? [
        `sqlite:${normalizedProjectPath}`,
        PROJECT_STORAGE_DIRECTORY,
        PROJECT_DATABASE_FILE,
      ].join("/")
    : DEFAULT_DATABASE_URL;

  if (targetUrl !== graphDatabaseUrl) {
    /*
     * Database.load replaces the pool per connection string, so
     * dropping the cached connection is enough: the next call
     * reopens the database at the new location.
     */
    logGraph(
      `switching graph database: ${graphDatabaseUrl} -> ${targetUrl}`,
    );

    graphDatabase = null;
    graphDatabaseUrl = targetUrl;
  }

  if (normalizedProjectPath) {
    const storageDirectory = [
      normalizedProjectPath,
      PROJECT_STORAGE_DIRECTORY,
    ].join("/");

    await mkdir(storageDirectory, {
      recursive: true,
    });
  }

  logGraph(
    `active graph database file: ${graphDatabaseUrl.replace(
      /^sqlite:/,
      "",
    )}`,
  );

  return graphDatabaseUrl.replace(
    /^sqlite:/,
    "",
  );
}

/**
 * Normalizes a project folder path to forward slashes without
 * trailing separators. Returns an empty string for null or empty
 * input.
 */
function normalizeProjectPath(
  projectPath: string | null,
): string {
  const trimmedPath =
    projectPath?.trim() ?? "";

  return trimmedPath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

function isAbsolutePath(
  normalizedPath: string,
): boolean {
  return /^(?:[a-zA-Z]:[\/]|\\\\|\/)/.test(
    normalizedPath,
  );
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Exposes the active graph database connection for read-only search
 * modules such as entityGraphSearch.
 *
 * The connection is owned by this module so that all callers share
 * the same SQLite database file.
 */
export async function getGraphDatabaseConnection(): Promise<Database> {
  return getGraphDatabase();
}

/**
 * Builds and stores the complete graph representation of a Window.
 *
 * It creates:
 *
 * Window --WINDOW_CONTAINS_TURN--> Turn
 * Turn   --TURN_MENTIONS_ENTITY--> Entity
 * Turn   --NEXT_TURN-------------> Next Turn (same Window only)
 *
 * NEXT_TURN edges are only created between consecutive Turns of the
 * given window.turns array, so Turns of one Window are never linked to
 * Turns of another Window.
 *
 * Call this function after every new Turn has been added to the Window.
 * Re-running it for the same Window is safe because all node and edge
 * identifiers are deterministic and every row is upserted.
 */
export async function indexWindowGraph(
  window: MemoryWindow,
): Promise<IndexWindowGraphResult> {
  assertValidWindow(window);

  const graph = buildWindowGraph(window);

  logGraph(
    `indexing window "${window.id}" (${window.turns.length} turn/s): building ${graph.nodes.length} nodes and ${graph.edges.length} edges`,
  );

  await runGraphExclusive(() =>
    persistGraph(
      graph.nodes,
      graph.edges,
      graph.windowId,
    ),
  );

  const result = createIndexResult(graph);

  logGraph(
    `indexed window "${window.id}": ${result.nodeCount} nodes (window: ${result.windowNodeCount}, turn: ${result.turnNodeCount}, entity: ${result.entityNodeCount}), ${result.edgeCount} edges (contains: ${result.containsEdgeCount}, mentions: ${result.mentionEdgeCount}, next-turn: ${result.nextTurnEdgeCount})`,
  );

  return result;
}

/**
 * Links all normalized Entities of a freshly created Turn to that Turn.
 *
 * Call this function once after createTurn(...) has returned. It stores:
 *
 * Turn --TURN_MENTIONS_ENTITY--> Entity
 *
 * The Turn node is stored without a Window at this point. When the Turn
 * is later added to a Window and indexWindowGraph(window) runs, the
 * Window id is filled in and NEXT_TURN connects the previous Turn of
 * that Window to this Turn.
 *
 * Re-running this function for the same Turn is safe because all node
 * and edge identifiers are deterministic and every row is upserted.
 */
export async function indexTurnEntities(
  turn: Turn,
): Promise<IndexTurnEntitiesResult> {
  assertValidEntitiesTurn(turn);

  const turnId = resolveTurnId(
    turn,
    null,
    null,
  );

  const turnNode = createTurnNode(
    turnId,
    turn,
    null,
    null,
  );

  const entityNodes: WindowGraphNode[] =
    [];

  const mentionEdges: WindowGraphEdge[] =
    [];

  const entities =
    turn.indexes.entities ?? [];

  for (
    let entityIndex = 0;
    entityIndex < entities.length;
    entityIndex += 1
  ) {
    const entity =
      entities[entityIndex];

    entityNodes.push(
      createEntityNode(entity),
    );

    mentionEdges.push(
      createTurnMentionsEntityEdge(
        null,
        turnId,
        entity,
        entityIndex,
      ),
    );
  }

  await runGraphExclusive(() =>
    persistGraph(
      [turnNode, ...entityNodes],
      mentionEdges,
      null,
    ),
  );

  logGraph(
    `indexed turn "${turnId}": ${mentionEdges.length} entity link/s`,
  );

  return {
    turnNodeId: turnNode.id,
    turnNode,

    entityNodeCount:
      entityNodes.length,

    mentionEdgeCount:
      mentionEdges.length,
  };
}

/**
 * Builds the Window graph without saving it.
 *
 * This is useful for testing and debugging.
 */
export function buildWindowGraph(
  window: MemoryWindow,
): WindowGraph {
  assertValidWindow(window);

  const nodeMap =
    new Map<string, WindowGraphNode>();

  const edgeMap =
    new Map<string, WindowGraphEdge>();

  const graphId =
    createWindowGraphId(window.id);

  const windowNode =
    createWindowNode(window);

  addNode(nodeMap, windowNode);

  /*
   * The order of window.turns is treated as the authoritative conversational
   * order. We do not sort by createdAt because equal timestamps or clock
   * changes could alter the original sequence.
   *
   * All edges below are scoped to this Window. NEXT_TURN is created only
   * between consecutive entries of window.turns, so a Turn is never
   * connected to a Turn of another Window.
   */
  for (
    let turnIndex = 0;
    turnIndex < window.turns.length;
    turnIndex += 1
  ) {
    const turn =
      window.turns[turnIndex];

    const turnId = resolveTurnId(
      turn,
      window.id,
      turnIndex,
    );

    const turnNode = createTurnNode(
      turnId,
      turn,
      window.id,
      turnIndex,
    );

    addNode(nodeMap, turnNode);

    addEdge(
      edgeMap,
      createWindowContainsTurnEdge(
        window.id,
        turnId,
        turnIndex,
      ),
    );

    /*
     * Connect every canonical normalized Entity to the Turn in which
     * it appears.
     */
    const entities =
      turn.indexes.entities ?? [];

    for (
      let entityIndex = 0;
      entityIndex < entities.length;
      entityIndex += 1
    ) {
      const entity =
        entities[entityIndex];

      const entityNode =
        createEntityNode(entity);

      addNode(nodeMap, entityNode);

      addEdge(
        edgeMap,
        createTurnMentionsEntityEdge(
          window.id,
          turnId,
          entity,
          entityIndex,
        ),
      );
    }

    /*
     * Connect neighboring Turns inside this Window.
     *
     * Turn 1 -> Turn 2 -> Turn 3
     */
    const nextTurn =
      window.turns[turnIndex + 1];

    if (nextTurn) {
      const nextTurnId =
        resolveTurnId(
          nextTurn,
          window.id,
          turnIndex + 1,
        );

      addEdge(
        edgeMap,
        createNextTurnEdge(
          window.id,
          turnId,
          nextTurnId,
          turnIndex,
        ),
      );
    }
  }

  const now =
    new Date().toISOString();

  return {
    id: graphId,
    windowId: window.id,

    nodes: Array.from(
      nodeMap.values(),
    ),

    edges: Array.from(
      edgeMap.values(),
    ),

    /*
     * Keep the original graph creation time when available.
     * For a rebuilt graph, startedAt is a stable approximation.
     */
    createdAt:
      window.startedAt ?? now,

    updatedAt: now,
  };
}

/**
 * Reads the stored graph of a Window from the SQLite graph tables.
 *
 * Returns the Window and Turn nodes of the Window plus every canonical
 * Entity node connected to its Turns.
 */
export async function getWindowGraph(
  windowId: string,
): Promise<StoredWindowGraph> {
  const normalizedWindowId =
    normalizeRequiredId(
      windowId,
      "Window id",
    );

  return runGraphExclusive(() =>
    readStoredWindowGraph(
      normalizedWindowId,
    ).then((graph) => {
      logGraph(
        `read graph of window "${normalizedWindowId}": ${graph.nodes.length} nodes, ${graph.edges.length} edges`,
      );

      return graph;
    }),
  );
}

/**
 * Removes the stored graph of one Window from the SQLite graph tables.
 *
 * The Window node, its Turn nodes, and all edges scoped to the Window
 * are deleted. Canonical Entity nodes are global and shared between
 * Windows, so they are kept.
 */
export async function deleteWindowGraph(
  windowId: string,
): Promise<void> {
  const normalizedWindowId =
    normalizeRequiredId(
      windowId,
      "Window id",
    );

  await runGraphExclusive(async () => {
    const database =
      await getGraphDatabase();

    await database.execute(
      `
        DELETE FROM ${GRAPH_EDGES_TABLE}
        WHERE window_id = ?
      `,
      [normalizedWindowId],
    );

    await database.execute(
      `
        DELETE FROM ${GRAPH_NODES_TABLE}
        WHERE window_id = ?
      `,
      [normalizedWindowId],
    );

    logGraph(
      `deleted stored graph of window "${normalizedWindowId}"`,
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Graph Persistence                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Upserts a list of nodes and edges into the SQLite graph tables.
 *
 * windowId is stored on Window and Turn nodes and on all edges. Entity
 * nodes are canonical across all Windows and therefore stored with a
 * null window_id.
 */
async function persistGraph(
  nodes: WindowGraphNode[],
  edges: WindowGraphEdge[],
  windowId: string | null,
): Promise<void> {
  for (
    let nodeIndex = 0;
    nodeIndex < nodes.length;
    nodeIndex += 1
  ) {
    const node = nodes[nodeIndex];

    const nodeWindowId =
      node.type === "entity"
        ? null
        : windowId;

    await upsertGraphNode(
      node,
      nodeWindowId,
    );
  }

  for (
    let edgeIndex = 0;
    edgeIndex < edges.length;
    edgeIndex += 1
  ) {
    await upsertGraphEdge(
      edges[edgeIndex],
      windowId,
    );
  }
}

/**
 * Inserts or updates one node row.
 *
 * Before the upsert, the existing row is validated:
 *
 * - The node type can never change.
 * - A Turn node that is already connected to one Window can never be
 *   claimed by another Window. This is the hard guard that keeps Turns
 *   of one Window separate from Turns of every other Window.
 */
async function upsertGraphNode(
  node: WindowGraphNode,
  windowId: string | null,
): Promise<void> {
  const database =
    await getGraphDatabase();

  const existingRow =
    await selectGraphNodeRow(
      database,
      node.id,
    );

  if (existingRow) {
    if (
      existingRow.node_type !==
      node.type
    ) {
      logGraphWarning(
        `rejected node "${node.id}": existing type "${existingRow.node_type}" cannot be replaced by "${node.type}"`,
      );

      throw new Error(
        `Graph node "${node.id}" already exists with type "${existingRow.node_type}" and cannot be replaced by type "${node.type}".`,
      );
    }

    if (
      node.type === "turn" &&
      existingRow.window_id &&
      windowId &&
      existingRow.window_id !==
        windowId
    ) {
      logGraphWarning(
        `rejected turn "${node.sourceId ?? node.id}": already connected to window "${existingRow.window_id}", cannot connect to window "${windowId}"`,
      );

      throw new Error(
        `Turn "${node.sourceId ?? node.id}" is already connected to Window "${existingRow.window_id}". A Turn can only be linked to Turns of its own Window.`,
      );
    }
  }

  const now = Date.now();

  const createdAt = existingRow
    ? parseDatabaseInteger(
        existingRow.created_at,
        "created_at",
        node.id,
      )
    : now;

  await database.execute(
    UPSERT_GRAPH_NODE,
    [
      node.id,
      node.type,
      node.sourceId ?? null,
      windowId,
      JSON.stringify(node.data),
      createdAt,
      now,
    ],
  );

  logGraph(
    `${existingRow ? "updated" : "created"} node [${node.type}] ${node.id}${
      windowId
        ? ` (window: ${windowId})`
        : ""
    }`,
  );
}

/**
 * Inserts or updates one edge row.
 *
 * Deterministic edge ids make this operation idempotent.
 */
async function upsertGraphEdge(
  edge: WindowGraphEdge,
  windowId: string | null,
): Promise<void> {
  const database =
    await getGraphDatabase();

  const existingRow =
    await selectGraphEdgeRow(
      database,
      edge.id,
    );

  const now = Date.now();

  const createdAt = existingRow
    ? parseDatabaseInteger(
        existingRow.created_at,
        "created_at",
        edge.id,
      )
    : now;

  await database.execute(
    UPSERT_GRAPH_EDGE,
    [
      edge.id,
      edge.type,
      edge.from,
      edge.to,
      windowId,
      JSON.stringify(edge.data ?? {}),
      createdAt,
      now,
    ],
  );

  logGraph(
    `${existingRow ? "updated" : "created"} edge [${edge.type}] ${edge.from} -> ${edge.to}${
      windowId
        ? ` (window: ${windowId})`
        : ""
    }`,
  );
}

/* -------------------------------------------------------------------------- */
/* Graph Reading                                                              */
/* -------------------------------------------------------------------------- */

async function selectGraphNodeRow(
  database: Database,
  nodeId: string,
): Promise<GraphNodeRow | null> {
  const rows =
    await database.select<
      GraphNodeRow[]
    >(
      `
        SELECT
          node_id,
          node_type,
          source_id,
          window_id,
          data,
          created_at,
          updated_at
        FROM ${GRAPH_NODES_TABLE}
        WHERE node_id = ?
        LIMIT 1
      `,
      [nodeId],
    );

  return rows[0] ?? null;
}

async function selectGraphEdgeRow(
  database: Database,
  edgeId: string,
): Promise<GraphEdgeRow | null> {
  const rows =
    await database.select<
      GraphEdgeRow[]
    >(
      `
        SELECT
          edge_id,
          edge_type,
          from_node,
          to_node,
          window_id,
          data,
          created_at,
          updated_at
        FROM ${GRAPH_EDGES_TABLE}
        WHERE edge_id = ?
        LIMIT 1
      `,
      [edgeId],
    );

  return rows[0] ?? null;
}

async function readStoredWindowGraph(
  windowId: string,
): Promise<StoredWindowGraph> {
  const database =
    await getGraphDatabase();

  const nodeRows =
    await database.select<
      GraphNodeRow[]
    >(
      `
        SELECT
          node_id,
          node_type,
          source_id,
          window_id,
          data,
          created_at,
          updated_at
        FROM ${GRAPH_NODES_TABLE}
        WHERE window_id = ?
        ORDER BY
          created_at ASC,
          node_id ASC
      `,
      [windowId],
    );

  const edgeRows =
    await database.select<
      GraphEdgeRow[]
    >(
      `
        SELECT
          edge_id,
          edge_type,
          from_node,
          to_node,
          window_id,
          data,
          created_at,
          updated_at
        FROM ${GRAPH_EDGES_TABLE}
        WHERE window_id = ?
        ORDER BY
          created_at ASC,
          edge_id ASC
      `,
      [windowId],
    );

  const nodes = nodeRows.map(
    mapGraphNodeRow,
  );

  const edges = edgeRows.map(
    mapGraphEdgeRow,
  );

  /*
   * Entity nodes are stored with a null window_id because they are
   * canonical across all Windows. Every Entity referenced by an edge of
   * this Window is loaded so that the graph is complete.
   */
  const missingNodeIds =
    collectMissingNodeIds(
      nodes,
      edges,
    );

  if (missingNodeIds.length > 0) {
    const placeholders =
      missingNodeIds
        .map(() => "?")
        .join(", ");

    const entityRows =
      await database.select<
        GraphNodeRow[]
      >(
        `
          SELECT
            node_id,
            node_type,
            source_id,
            window_id,
            data,
            created_at,
            updated_at
          FROM ${GRAPH_NODES_TABLE}
          WHERE node_id IN (${placeholders})
          ORDER BY
            created_at ASC,
            node_id ASC
        `,
        missingNodeIds,
      );

    nodes.push(
      ...entityRows.map(
        mapGraphNodeRow,
      ),
    );
  }

  return {
    graphId: createWindowGraphId(
      windowId,
    ),
    windowId,
    nodes,
    edges,
  };
}

function collectMissingNodeIds(
  nodes: WindowGraphNode[],
  edges: WindowGraphEdge[],
): string[] {
  const knownNodeIds = new Set(
    nodes.map((node) => node.id),
  );

  const missingNodeIds: string[] = [];

  for (const edge of edges) {
    if (
      !knownNodeIds.has(edge.from)
    ) {
      knownNodeIds.add(edge.from);
      missingNodeIds.push(edge.from);
    }

    if (
      !knownNodeIds.has(edge.to)
    ) {
      knownNodeIds.add(edge.to);
      missingNodeIds.push(edge.to);
    }
  }

  return missingNodeIds;
}

function mapGraphNodeRow(
  row: GraphNodeRow,
): WindowGraphNode {
  const sourceId =
    row.source_id === null
      ? undefined
      : row.source_id;

  return {
    id: row.node_id,
    type: row.node_type as WindowGraphNodeType,
    sourceId,
    data: parseGraphJson(
      row.data,
      row.node_id,
    ),
  };
}

function mapGraphEdgeRow(
  row: GraphEdgeRow,
): WindowGraphEdge {
  return {
    id: row.edge_id,
    type: row.edge_type as WindowGraphEdgeType,
    from: row.from_node,
    to: row.to_node,
    data: parseGraphJson(
      row.data,
      row.edge_id,
    ),
  };
}

function parseGraphJson(
  payload: string,
  graphKey: string,
): Record<string, unknown> {
  try {
    const parsed =
      JSON.parse(payload) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        "The value is not a JSON object.",
      );
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Graph record "${graphKey}" contains invalid JSON: ${message}`,
    );
  }
}

function parseDatabaseInteger(
  value: number | string,
  columnName: string,
  graphKey: string,
): number {
  const numericValue = Number(value);

  if (
    !Number.isSafeInteger(numericValue)
  ) {
    throw new Error(
      `Graph record "${graphKey}" contains an invalid ${columnName} value.`,
    );
  }

  return numericValue;
}

/* -------------------------------------------------------------------------- */
/* Node Creation                                                              */
/* -------------------------------------------------------------------------- */

function createWindowNode(
  window: MemoryWindow,
): WindowGraphNode {
  return {
    id: createWindowNodeId(
      window.id,
    ),

    type: "window",
    sourceId: window.id,

    data: {
      windowId: window.id,
      status: window.status,
      estimatedTokens:
        window.estimatedTokens,
      turnCount: window.turns.length,
      startedAt: window.startedAt,
      updatedAt: window.updatedAt,

      ...(window.closedAt
        ? {
            closedAt:
              window.closedAt,
          }
        : {}),

      ...(window.boundaryReason
        ? {
            boundaryReason:
              window.boundaryReason,
          }
        : {}),

      /*
       * Window indexes are preserved so graph retrieval can later use
       * subjects, keywords, entities, embeddings, or other Window metadata.
       */
      indexes: window.indexes,
    },
  };
}

function createTurnNode(
  turnId: string,
  turn: Turn,
  windowId: string | null,
  position: number | null,
): WindowGraphNode {
  return {
    id: createTurnNodeId(turnId),

    type: "turn",
    sourceId: turnId,

    data: {
      turnId,
      windowId,
      position,

      userMessage:
        turn.userMessage,

      agentResponse:
        turn.agentResponse,

      subject:
        turn.indexes.subject,

      keywords:
        turn.indexes.keywords,

      type:
        turn.indexes.type,

      estimatedTokens:
        turn.estimatedTokens,

      createdAt:
        turn.createdAt,
    },
  };
}

function createEntityNode(
  entity: NonNullable<
    Turn["indexes"]["entities"]
  >[number],
): WindowGraphNode {
  const normalized =
    normalizeCanonicalEntity(
      entity.normalized,
    );

  return {
    id: createEntityNodeId(
      normalized,
      entity.type,
    ),

    type: "entity",

    data: {
      normalized,
      entityType: entity.type,

      /*
       * This is only one observed surface form.
       * The canonical identity is based on normalized + type.
       */
      text: entity.text.trim(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Edge Creation                                                              */
/* -------------------------------------------------------------------------- */

function createWindowContainsTurnEdge(
  windowId: string,
  turnId: string,
  turnIndex: number,
): WindowGraphEdge {
  const from =
    createWindowNodeId(windowId);

  const to =
    createTurnNodeId(turnId);

  return {
    id: createEdgeId(
      "WINDOW_CONTAINS_TURN",
      from,
      to,
    ),

    type: "WINDOW_CONTAINS_TURN",
    from,
    to,

    data: {
      windowId,
      turnId,
      position: turnIndex,
    },
  };
}

function createTurnMentionsEntityEdge(
  windowId: string | null,
  turnId: string,
  entity: NonNullable<
    Turn["indexes"]["entities"]
  >[number],
  entityIndex: number,
): WindowGraphEdge {
  const normalized =
    normalizeCanonicalEntity(
      entity.normalized,
    );

  const from =
    createTurnNodeId(turnId);

  const to =
    createEntityNodeId(
      normalized,
      entity.type,
    );

  return {
    id: createEdgeId(
      "TURN_MENTIONS_ENTITY",
      from,
      to,
    ),

    type: "TURN_MENTIONS_ENTITY",
    from,
    to,

    data: {
      windowId,
      turnId,

      /*
       * Keep the original mention for provenance.
       */
      mentionText:
        entity.text.trim(),

      normalized,
      entityType: entity.type,
      entityIndex,
    },
  };
}

/**
 * Creates a NEXT_TURN edge between two Turns of the SAME Window.
 *
 * This function must only be called with Turn ids that belong to the
 * given Window, because both endpoints are stored with the Window id in
 * the edge data and in the window_id column.
 */
function createNextTurnEdge(
  windowId: string,
  currentTurnId: string,
  nextTurnId: string,
  currentPosition: number,
): WindowGraphEdge {
  const from =
    createTurnNodeId(currentTurnId);

  const to =
    createTurnNodeId(nextTurnId);

  return {
    id: createEdgeId(
      "NEXT_TURN",
      from,
      to,
    ),

    type: "NEXT_TURN",
    from,
    to,

    data: {
      windowId,

      fromTurnId:
        currentTurnId,

      toTurnId:
        nextTurnId,

      fromPosition:
        currentPosition,

      toPosition:
        currentPosition + 1,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Graph Helpers                                                              */
/* -------------------------------------------------------------------------- */

function addNode(
  nodeMap: Map<
    string,
    WindowGraphNode
  >,
  node: WindowGraphNode,
): void {
  const existingNode =
    nodeMap.get(node.id);

  if (!existingNode) {
    nodeMap.set(
      node.id,
      node,
    );

    return;
  }

  /*
   * Entity Nodes may be encountered in several Turns. Their stable ID keeps
   * them canonical. Existing canonical data is preserved.
   */
  if (
    existingNode.type ===
      "entity" &&
    node.type === "entity"
  ) {
    return;
  }

  /*
   * Receiving the same non-Entity node twice is safe only when its type is
   * unchanged.
   */
  if (
    existingNode.type !==
    node.type
  ) {
    throw new Error(
      `Graph node "${node.id}" has conflicting node types.`,
    );
  }
}

function addEdge(
  edgeMap: Map<
    string,
    WindowGraphEdge
  >,
  edge: WindowGraphEdge,
): void {
  /*
   * Deterministic IDs automatically remove duplicate relations.
   */
  if (!edgeMap.has(edge.id)) {
    edgeMap.set(
      edge.id,
      edge,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* IDs                                                                        */
/* -------------------------------------------------------------------------- */

function createWindowGraphId(
  windowId: string,
): string {
  return `window-graph:${encodeGraphPart(
    windowId,
  )}`;
}

function createWindowNodeId(
  windowId: string,
): string {
  return `window:${encodeGraphPart(
    windowId,
  )}`;
}

function createTurnNodeId(
  turnId: string,
): string {
  return `turn:${encodeGraphPart(
    turnId,
  )}`;
}

function createEntityNodeId(
  normalized: string,
  entityType: string,
): string {
  return [
    "entity",
    encodeGraphPart(entityType),
    encodeGraphPart(normalized),
  ].join(":");
}

function createEdgeId(
  type: WindowGraphEdgeType,
  from: string,
  to: string,
): string {
  return [
    "edge",
    type,
    encodeGraphPart(from),
    encodeGraphPart(to),
  ].join(":");
}

function encodeGraphPart(
  value: string,
): string {
  return encodeURIComponent(
    value.trim(),
  );
}

/**
 * Returns the stable id of a Turn.
 *
 * Turns created by createTurn always contain an id. The Window layer Turn
 * type does not declare the id field, so it is read defensively here. When
 * a Turn has no id, a deterministic fallback based on the owning Window
 * and its position is used. A standalone Turn without an id cannot be
 * indexed because no stable identity exists for it.
 */
function resolveTurnId(
  turn: Turn,
  windowId: string | null,
  position: number | null,
): string {
  const candidate =
    (turn as { id?: unknown }).id;

  if (
    typeof candidate === "string" &&
    candidate.trim()
  ) {
    return candidate.trim();
  }

  if (
    windowId &&
    position !== null
  ) {
    return `turn-fallback:${windowId}:${position}`;
  }

  throw new Error(
    "The Turn has no stable id. Pass the Turn created by createTurn (which contains an id) or index the Turn inside a Window.",
  );
}

function normalizeRequiredId(
  value: string,
  label: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(
      `${label} must be a string.`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new Error(
      `${label} cannot be empty.`,
    );
  }

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function assertValidWindow(
  window: MemoryWindow,
): void {
  if (
    !window ||
    typeof window !== "object"
  ) {
    throw new TypeError(
      "Window must be an object.",
    );
  }

  if (
    typeof window.id !== "string" ||
    !window.id.trim()
  ) {
    throw new Error(
      "Window id cannot be empty.",
    );
  }

  if (
    !Array.isArray(window.turns)
  ) {
    throw new Error(
      "Window turns must be an array.",
    );
  }

  const seenTurnIds =
    new Set<string>();

  for (
    let turnIndex = 0;
    turnIndex < window.turns.length;
    turnIndex += 1
  ) {
    const turn =
      window.turns[turnIndex];

    assertValidGraphTurn(
      turn,
      turnIndex,
    );

    const turnId = resolveTurnId(
      turn,
      window.id,
      turnIndex,
    );

    if (
      seenTurnIds.has(turnId)
    ) {
      throw new Error(
        `Window contains duplicate Turn id "${turnId}".`,
      );
    }

    seenTurnIds.add(turnId);
  }
}

function assertValidEntitiesTurn(
  turn: Turn,
): void {
  if (
    !turn ||
    typeof turn !== "object"
  ) {
    throw new TypeError(
      "Turn must be an object.",
    );
  }

  if (
    !turn.indexes ||
    typeof turn.indexes !== "object"
  ) {
    throw new Error(
      "The Turn must contain indexes.",
    );
  }

  if (
    !Array.isArray(
      turn.indexes.entities ?? [],
    )
  ) {
    throw new Error(
      "The Turn does not contain a valid entities array.",
    );
  }

  const entities =
    turn.indexes.entities ?? [];

  for (
    let entityIndex = 0;
    entityIndex < entities.length;
    entityIndex += 1
  ) {
    assertValidEntity(
      entities[entityIndex],
      entityIndex,
      turn,
    );
  }
}

function assertValidGraphTurn(
  turn: Turn,
  turnIndex: number,
): void {
  if (
    !turn ||
    typeof turn !== "object"
  ) {
    throw new Error(
      `Turn at index ${turnIndex} must be an object.`,
    );
  }

  if (
    !turn.indexes ||
    !Array.isArray(
      turn.indexes.entities ?? [],
    )
  ) {
    throw new Error(
      `Turn at index ${turnIndex} does not contain a valid entities array.`,
    );
  }

  const entities =
    turn.indexes.entities ?? [];

  for (
    let entityIndex = 0;
    entityIndex < entities.length;
    entityIndex += 1
  ) {
    assertValidEntity(
      entities[entityIndex],
      entityIndex,
      turn,
    );
  }
}

function assertValidEntity(
  entity: unknown,
  entityIndex: number,
  turn: Turn,
): void {
  if (
    !entity ||
    typeof entity !== "object"
  ) {
    throw new Error(
      `Entity at index ${entityIndex} in Turn "${turn.userMessage.slice(0, 32)}" must be an object.`,
    );
  }

  const candidate =
    entity as {
      normalized?: unknown;
      text?: unknown;
      type?: unknown;
    };

  if (
    typeof candidate.normalized !==
      "string" ||
    !candidate.normalized.trim()
  ) {
    throw new Error(
      `Entity at index ${entityIndex} has an invalid normalized value.`,
    );
  }

  if (
    typeof candidate.text !==
      "string" ||
    !candidate.text.trim()
  ) {
    throw new Error(
      `Entity at index ${entityIndex} has an invalid text value.`,
    );
  }

  if (
    typeof candidate.type !==
      "string" ||
    !candidate.type.trim()
  ) {
    throw new Error(
      `Entity at index ${entityIndex} has an invalid type.`,
    );
  }
}

function normalizeCanonicalEntity(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/* -------------------------------------------------------------------------- */
/* Result                                                                     */
/* -------------------------------------------------------------------------- */

function createIndexResult(
  graph: WindowGraph,
): IndexWindowGraphResult {
  return {
    graphId: graph.id,
    graph,

    nodeCount:
      graph.nodes.length,

    edgeCount:
      graph.edges.length,

    windowNodeCount:
      graph.nodes.filter(
        (node) =>
          node.type === "window",
      ).length,

    turnNodeCount:
      graph.nodes.filter(
        (node) =>
          node.type === "turn",
      ).length,

    entityNodeCount:
      graph.nodes.filter(
        (node) =>
          node.type === "entity",
      ).length,

    containsEdgeCount:
      graph.edges.filter(
        (edge) =>
          edge.type ===
          "WINDOW_CONTAINS_TURN",
      ).length,

    mentionEdgeCount:
      graph.edges.filter(
        (edge) =>
          edge.type ===
          "TURN_MENTIONS_ENTITY",
      ).length,

    nextTurnEdgeCount:
      graph.edges.filter(
        (edge) =>
          edge.type === "NEXT_TURN",
      ).length,
  };
}
