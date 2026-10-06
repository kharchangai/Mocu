// Persists all agent-run graphs in one application-global SQLite database:
// <AppData>/graph/run-graphs.db. Project paths are retained as graph metadata,
// but never determine the storage location.

import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, mkdir } from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";
import { textSimilarity } from "../services/ai/tools/textSimilarity";
import { readSettings } from "../store";
import type { AgentRunGraph } from "./graphMaker";
import { getGraphFilePaths, snapshotProjectFiles, type ProjectFileSnapshot } from "./fileSnapshot";

export const RUN_GRAPH_RECORD_TYPE = "run_graph";
export const GRAPH_DATABASE_DIRECTORY = "graph";
export const GRAPH_DATABASE_FILE = "run-graphs.db";

export type RunGraphSearchable = {
  userMessage: string;
  finalAnswer: string;
  /** One line per kept tool call: name(args): result excerpt. */
  toolSummary: string;
};

export type StoredRunGraphData = {
  agentKind: string;
  chatId?: string;
  savedAt: number;
  graph: AgentRunGraph;
  searchable: RunGraphSearchable;
  embedding: number[] | null;
  embeddingModel: string | null;
  fileSnapshot?: ProjectFileSnapshot;
};

export type SaveRunGraphResult = {
  key: string;
  embedded: boolean;
  embedError?: string;
};

const RESULT_EXCERPT_LIMIT = 200;
let databasePromise: Promise<Database> | null = null;

export const graphDatabaseUrl = async (): Promise<string> => {
  const dataDir = await appDataDir();
  const path = await join(dataDir, GRAPH_DATABASE_DIRECTORY, GRAPH_DATABASE_FILE);
  return `sqlite:${path.replace(/\\/g, "/")}`;
};

const connectGraphDatabase = async (): Promise<Database> => {
  await mkdir(GRAPH_DATABASE_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
  const database = await Database.load(await graphDatabaseUrl());
  await database.execute(`
    CREATE TABLE IF NOT EXISTS run_graphs (
      run_id TEXT PRIMARY KEY NOT NULL,
      saved_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    )
  `);
  await database.execute("CREATE INDEX IF NOT EXISTS idx_run_graphs_saved_at ON run_graphs(saved_at)");
  await database.select("SELECT 1");
  return database;
};

const getGraphDatabase = async (): Promise<Database> => {
  if (!databasePromise) {
    const pending = connectGraphDatabase();
    databasePromise = pending;
    void pending.catch(() => {
      if (databasePromise === pending) databasePromise = null;
    });
  }
  return databasePromise;
};

/** Extract searchable text from a cleaned graph. */
export const buildRunGraphSearchable = (graph: AgentRunGraph): RunGraphSearchable => {
  const userMessageNode = graph.nodes.find((node) => node.kind === "user_message");
  const finalAnswerNode = graph.nodes.find((node) => node.kind === "final_answer");
  const toolLines = graph.nodes
    .filter((node) => node.kind === "tool_call")
    .map((node) => {
      const tool = typeof node.attributes.tool === "string" ? node.attributes.tool : node.label;
      const args = node.attributes.args !== undefined ? JSON.stringify(node.attributes.args) : "";
      const result = typeof node.attributes.result === "string" ? node.attributes.result.slice(0, RESULT_EXCERPT_LIMIT) : "";
      const head = args ? `${tool}(${args})` : tool;
      return result ? `${head}: ${result}` : head;
    });
  return {
    userMessage: typeof userMessageNode?.attributes.text === "string" ? userMessageNode.attributes.text : "",
    finalAnswer: typeof finalAnswerNode?.attributes.text === "string" ? finalAnswerNode.attributes.text : "",
    toolSummary: toolLines.join("\n"),
  };
};

export const buildRunGraphEmbeddingText = (searchable: RunGraphSearchable): string => {
  const parts = [`User: ${searchable.userMessage}`, `Answer: ${searchable.finalAnswer}`];
  if (searchable.toolSummary) parts.push(`Tools:\n${searchable.toolSummary}`);
  return parts.join("\n");
};

/** Save globally. projectPath remains optional for backward-compatible call sites and is not used to choose storage. */
export const saveRunGraph = async (
  projectPath: string | undefined,
  graph: AgentRunGraph,
): Promise<SaveRunGraphResult> => {
  const database = await getGraphDatabase();
  const searchable = buildRunGraphSearchable(graph);
  let fileSnapshot: ProjectFileSnapshot | undefined;
  if (projectPath?.trim()) {
    try {
      fileSnapshot = await snapshotProjectFiles(projectPath, getGraphFilePaths(graph, projectPath));
    } catch (error) {
      console.warn("[Graph Storage] File snapshot failed; freshness will be unknown:", error);
    }
  }

  const data: StoredRunGraphData = {
    agentKind: graph.agentKind,
    ...(graph.chatId !== undefined ? { chatId: graph.chatId } : {}),
    savedAt: Date.now(),
    graph,
    searchable,
    embedding: null,
    embeddingModel: null,
    ...(fileSnapshot ? { fileSnapshot } : {}),
  };

  // Persist the graph before optional embedding, so embedding/config failures never lose the graph.
  await database.execute(
    "INSERT INTO run_graphs (run_id, saved_at, payload) VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET saved_at = excluded.saved_at, payload = excluded.payload",
    [graph.runId, data.savedAt, JSON.stringify(data)],
  );

  try {
    const settings = await readSettings();
    if (!settings.embeddingModel || !settings.embeddingBaseUrl) throw new Error("Embedding model is not configured.");
    const embedding = await textSimilarity.embedText(buildRunGraphEmbeddingText(searchable));
    const embeddedData: StoredRunGraphData = { ...data, embedding, embeddingModel: settings.embeddingModel };
    await database.execute("UPDATE run_graphs SET payload = ? WHERE run_id = ?", [JSON.stringify(embeddedData), graph.runId]);
    return { key: graph.runId, embedded: true };
  } catch (error) {
    return { key: graph.runId, embedded: false, embedError: error instanceof Error ? error.message : String(error) };
  }
};

export const loadRunGraph = async (
  _projectPath: string | undefined,
  runId: string,
): Promise<StoredRunGraphData | null> => {
  const database = await getGraphDatabase();
  const rows = await database.select<Array<{ payload: string }>>(
    "SELECT payload FROM run_graphs WHERE run_id = ? LIMIT 1",
    [runId],
  );
  return rows[0] ? JSON.parse(rows[0].payload) as StoredRunGraphData : null;
};

export const listRunGraphs = async (_projectPath?: string): Promise<StoredRunGraphData[]> => {
  const database = await getGraphDatabase();
  const rows = await database.select<Array<{ payload: string }>>(
    "SELECT payload FROM run_graphs ORDER BY saved_at DESC",
  );
  return rows.map((row) => JSON.parse(row.payload) as StoredRunGraphData);
};

/** Test-only hook: reset the cached connection promise without closing Tauri's shared pool. */
export const resetGraphDatabaseCacheForTests = (): void => {
  databasePromise = null;
};
