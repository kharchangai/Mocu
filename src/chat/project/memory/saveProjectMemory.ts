// saveProjectMemory.ts

/**
 * Background entry point of the project memory system.
 *
 * User message + Agent response
 *   -> Turn    (createTurn inside processTurn)
 *   -> Window  (addTurnToWindow inside processTurn)
 *   -> Episode (assignWindowToEpisode inside processTurn)
 *
 * All three layers are persisted by the pipeline itself in the SQLite
 * database of the user-selected project folder:
 *
 *   <projectPath>/.mocu/storage/memory.db
 *
 * Entity memory is persisted in a separate SQLite file in the same
 * project storage directory:
 *
 *   <projectPath>/.mocu/storage/memoryx.db
 *
 * When no projectPath is given, the default database inside the
 * application configuration directory is used.
 *
 * This module performs no LLM calls and no agent/tool calls of its
 * own. It only points the persistence layer at the project database
 * and runs the Turn -> Window -> Episode pipeline completely detached
 * from the agent response (fire and forget).
 */

import { processTurn } from "./processTurn";

import type {
  ProcessTurnResult,
} from "./processTurn";

import { databaseManager } from "./storage/databaseManager";
import { entityMemoryStore } from "./memory-retrieval/entityMemoryStore";
import { useWindowGraphDatabase } from "./window/windowGraphIndexer";

/* -------------------------------------------------------------------------- */
/* Storage Locations                                                          */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Public Types                                                               */
/* -------------------------------------------------------------------------- */

export type SaveProjectMemoryInput = {
  userMessage: string;
  agentResponse: string;
  projectPath?: string | null;
};

export type SaveProjectMemoryResult = {
  storageType: "project" | "app-data";

  /**
   * File path of the SQLite database the pipeline was persisted in.
   */
  databasePath: string;

  processResult: ProcessTurnResult;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Converts a project folder path into a forward-slash form that the
 * SQLite connection string accepts on every platform.
 */
const toForwardSlashes = (path: string): string => {
  return path.replace(/\\/g, "/");
};

/**
 * Removes trailing separators from a project folder path.
 */
const normalizeProjectPath = (path: string): string => {
  return toForwardSlashes(path).replace(/\/+$/, "");
};

/* -------------------------------------------------------------------------- */
/* Pipeline Queue                                                             */
/* -------------------------------------------------------------------------- */

/**
 * All background pipelines run strictly one after another so that
 * switching the database between projects can never interleave with a
 * running pipeline.
 */
let pipelineQueue: Promise<void> = Promise.resolve();

/* -------------------------------------------------------------------------- */
/* Main Function                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Processes one conversation turn through the complete memory
 * hierarchy (Turn -> Window -> Episode) in the background and lets the
 * pipeline persist everything in the SQLite database of the
 * user-selected project folder.
 *
 * If projectPath is provided, all data is saved in:
 *   <projectPath>/.mocu/storage/memory.db
 *
 * Otherwise, the data is saved in the default database inside the
 * application configuration directory.
 */
export function saveProjectMemory(
  input: SaveProjectMemoryInput,
): Promise<SaveProjectMemoryResult> {
  const operation =
    runProjectMemoryPipeline(input);

  /*
   * The finished pipeline is appended to the queue so the next call
   * waits for it, regardless of whether it succeeded or failed.
   */
  pipelineQueue = operation.then(
    () => undefined,
    () => undefined,
  );

  return operation;
}

/* -------------------------------------------------------------------------- */
/* Pipeline Execution                                                         */
/* -------------------------------------------------------------------------- */

async function runProjectMemoryPipeline({
  userMessage,
  agentResponse,
  projectPath,
}: SaveProjectMemoryInput): Promise<SaveProjectMemoryResult> {
  await pipelineQueue;

  const normalizedUserMessage =
    userMessage.trim();

  const normalizedAgentResponse =
    agentResponse.trim();

  const normalizedProjectPath =
    projectPath?.trim() ?? "";

  if (!normalizedUserMessage) {
    throw new Error(
      "The user message cannot be empty when saving project memory.",
    );
  }

  if (!normalizedAgentResponse) {
    throw new Error(
      "The agent response cannot be empty when saving project memory.",
    );
  }

  /*
   * Point the persistence layer at the SQLite database of the
   * user-selected project folder before the pipeline runs.
   *
   * The entity memory store uses its own SQLite file in the same
   * project storage directory:
   *   <projectPath>/.mocu/storage/memoryx.db
   */
  const databasePath =
    await databaseManager.useProjectDatabase(
      normalizedProjectPath || null,
    );

  await entityMemoryStore.useProjectDatabase(
    normalizedProjectPath || null,
  );

  /*
   * The graph database is its own SQLite file in the same project
   * storage directory:
   *   <projectPath>/.mocu/storage/memory-graph.db
   */
  await useWindowGraphDatabase(
    normalizedProjectPath || null,
  );

  /*
   * Run the complete memory pipeline:
   * Turn -> Window -> Episode.
   *
   * createTurn, WindowManager, and EpisodeManager persist every
   * record themselves in the active SQLite database.
   */
  const processResult = await processTurn(
    normalizedUserMessage,
    normalizedAgentResponse,
  );

  return {
    storageType: normalizedProjectPath
      ? "project"
      : "app-data",

    databasePath,

    processResult,
  };
}

export { normalizeProjectPath, toForwardSlashes };
