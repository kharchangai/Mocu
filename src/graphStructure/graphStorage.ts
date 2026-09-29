// src/graphStructure/graphStorage.ts
//
// Persists a cleaned agent-run graph into the PROJECT database only:
//
//   await databaseManager.useProjectDatabase(projectPath)
//   → <projectPath>/.mocu/storage/memory.db, table `records`
//   → one row per run: type "run_graph", key = runId
//
// Each row stores:
//   graph        the cleaned nodes/edges (output of cleanup + buildGraph)
//   searchable   raw texts kept for search (user message, final answer,
//                one-line summary per kept tool call)
//   embedding    vector over `searchable` for step-5 retrieval
//                (null when embedding failed — save never fails on it)
//   embeddingModel  which model produced the vector, so a model change
//                can trigger a re-embed later
//
// Save order is fail-open: the graph row is always written first; the
// embedding is attempted afterwards and patched in with an update.
// The same principle as cleanup: never lose data because a side service
// is down.

import { databaseManager } from "../chat/project/memory/storage/databaseManager";
import { textSimilarity } from "../services/ai/tools/textSimilarity";
import { readSettings } from "../store";
import type { AgentRunGraph } from "./graphMaker";
import { getGraphFilePaths, snapshotProjectFiles, type ProjectFileSnapshot } from "./fileSnapshot";

export const RUN_GRAPH_RECORD_TYPE = "run_graph";

/** Raw texts kept per run; the source for embedding and future BM25. */
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
  /** SHA-256 hashes of files referenced by the run; Git is never invoked. */
  fileSnapshot?: ProjectFileSnapshot;
};

export type SaveRunGraphResult = {
  key: string;
  embedded: boolean;
  embedError?: string;
};

const RESULT_EXCERPT_LIMIT = 200;

/**
 * Extracts the searchable texts from a cleaned graph. Pure function:
 * works on any AgentRunGraph, no database involved.
 */
export const buildRunGraphSearchable = (
  graph: AgentRunGraph,
): RunGraphSearchable => {
  const userMessageNode = graph.nodes.find(
    (node) => node.kind === "user_message",
  );
  const finalAnswerNode = graph.nodes.find(
    (node) => node.kind === "final_answer",
  );

  const toolLines = graph.nodes
    .filter((node) => node.kind === "tool_call")
    .map((node) => {
      const tool =
        typeof node.attributes.tool === "string"
          ? node.attributes.tool
          : node.label;
      const args =
        node.attributes.args !== undefined
          ? JSON.stringify(node.attributes.args)
          : "";
      const result =
        typeof node.attributes.result === "string"
          ? node.attributes.result.slice(0, RESULT_EXCERPT_LIMIT)
          : "";

      const head = args ? `${tool}(${args})` : tool;
      return result ? `${head}: ${result}` : head;
    });

  return {
    userMessage:
      typeof userMessageNode?.attributes.text === "string"
        ? userMessageNode.attributes.text
        : "",
    finalAnswer:
      typeof finalAnswerNode?.attributes.text === "string"
        ? finalAnswerNode.attributes.text
        : "",
    toolSummary: toolLines.join("\n"),
  };
};

/**
 * Single stable text sent to the embedding model for one run.
 */
export const buildRunGraphEmbeddingText = (
  searchable: RunGraphSearchable,
): string => {
  const parts = [
    `User: ${searchable.userMessage}`,
    `Answer: ${searchable.finalAnswer}`,
  ];

  if (searchable.toolSummary) {
    parts.push(`Tools:\n${searchable.toolSummary}`);
  }

  return parts.join("\n");
};

const assertProjectPath = (projectPath: string): string => {
  const trimmed = projectPath.trim();

  if (!trimmed) {
    throw new Error(
      "Graph storage requires a project folder; no project is active.",
    );
  }

  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");

  if (!/^(?:[a-zA-Z]:[\/]|\\\\|\/)/.test(normalized)) {
    throw new Error(
      `The project folder path must be absolute: ${projectPath}`,
    );
  }

  return normalized;
};

/**
 * Saves a cleaned run graph into the project database, then best-effort
 * embeds its searchable texts. Returns whether the row was written and
 * whether the embedding succeeded (a failed embedding never throws).
 */
export const saveRunGraph = async (
  projectPath: string,
  graph: AgentRunGraph,
): Promise<SaveRunGraphResult> => {
  const normalizedProjectPath = assertProjectPath(projectPath);

  await databaseManager.useProjectDatabase(normalizedProjectPath);

  const searchable = buildRunGraphSearchable(graph);
  let fileSnapshot: ProjectFileSnapshot | undefined;
  try {
    const paths = getGraphFilePaths(graph, normalizedProjectPath);
    fileSnapshot = await snapshotProjectFiles(normalizedProjectPath, paths);
  } catch (error) {
    console.warn("[Graph Storage] File snapshot failed; freshness will be unknown:", error);
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
  // 1) The graph row is always written, embedding or not.
  await databaseManager.upsert<StoredRunGraphData>({
    type: RUN_GRAPH_RECORD_TYPE,
    key: graph.runId,
    data,
  });

  // 2) Best-effort embedding, patched in afterwards (fail-open).
  try {
    const settings = await readSettings();

    if (!settings.embeddingModel || !settings.embeddingBaseUrl) {
      throw new Error("Embedding model is not configured.");
    }

    const embedding = await textSimilarity.embedText(
      buildRunGraphEmbeddingText(searchable),
    );

    await databaseManager.update<StoredRunGraphData>(graph.runId, {
      ...data,
      embedding,
      embeddingModel: settings.embeddingModel,
    });

    return { key: graph.runId, embedded: true };
  } catch (error) {
    return {
      key: graph.runId,
      embedded: false,
      embedError: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Loads one saved run graph from the project database.
 */
export const loadRunGraph = async (
  projectPath: string,
  runId: string,
): Promise<StoredRunGraphData | null> => {
  await databaseManager.useProjectDatabase(assertProjectPath(projectPath));

  const record = await databaseManager.get<StoredRunGraphData>(runId);

  if (!record || record.type !== RUN_GRAPH_RECORD_TYPE) {
    return null;
  }

  return record.data;
};

/**
 * Lists every saved run graph of the project (input for step-5 search).
 */
export const listRunGraphs = async (
  projectPath: string,
): Promise<StoredRunGraphData[]> => {
  await databaseManager.useProjectDatabase(assertProjectPath(projectPath));

  const records =
    await databaseManager.getByType<StoredRunGraphData>(
      RUN_GRAPH_RECORD_TYPE,
    );

  return records.map((record) => record.data);
};
