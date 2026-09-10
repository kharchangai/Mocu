// memory-retrieval/memoryPipeline.ts

/**
 * Entity memory pipeline.
 *
 * Takes the current user message and the active project folder and
 * runs the full entity-based memory retrieval as a simple
 * sequential pipeline (no graph/state machine):
 *
 *   user message + project path
 *     -> init database    (bind the entity store + graph index to
 *                          the project folder)
 *     -> extract entities (LLM candidates, resolved against the
 *                          SQLite entity database)
 *     -> search graph     (entity + semantic ranked Turn search in
 *                          memory-graph.db)
 *     -> build memory     (format the ranked Turns as a ready-to-
 *                          inject memory context string)
 *
 * The pipeline returns the result as memory (`memoryContext`) plus
 * the raw intermediate data for logging/debugging.
 */

import {
  extractEntities,
  useMessageEntityDatabase,
} from "./extractMessageEntities";

import {
  searchGraphEntities,
  type GraphEntitySearchResult,
} from "./entityGraphSearch";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Result of the pipeline. Each field is produced exactly once by
 * one step.
 */
export interface MemoryPipelineResult {
  /** Input: the current user message. */
  userMessage: string;

  /** Input: the active project ROOT folder (no .mocu/storage part). */
  projectPath: string;

  /** Path of the SQLite entity database bound to the project. */
  entityDatabasePath: string;

  /** Entities extracted from the user message and found in the DB. */
  entities: string[];

  /** Raw graph search result (matches + ranked turns). */
  graphResult: GraphEntitySearchResult | null;

  /**
   * Output: the ready-to-use memory context text. Empty string when
   * no related memory exists for the message.
   */
  memoryContext: string;
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Step 1: point the entity store AND the graph index at the selected
 * project folder before anything runs. Without this, extractEntities()
 * matches against the global memoryx.db in the app config directory
 * and always returns [].
 */
async function initDatabaseStep(
  projectPath: string,
): Promise<string> {
  const entityDatabasePath =
    await useMessageEntityDatabase(projectPath);

  console.log(
    `[MemoryPipeline] entity database: ${entityDatabasePath}`,
  );

  return entityDatabasePath;
}

/**
 * Step 2: extract entity candidates from the user message and resolve
 * them strictly against the entities that already exist in SQLite.
 */
async function extractEntitiesStep(
  userMessage: string,
): Promise<string[]> {
  const entities = await extractEntities(userMessage);

  console.log(
    `[MemoryPipeline] extracted ${entities.length} entity/ies: ${JSON.stringify(entities)}`,
  );

  return entities;
}

/**
 * Step 3: search the extracted entities in the graph database
 * (memory-graph.db) and rank the found Turns by entity coverage and
 * semantic similarity.
 */
async function searchGraphStep(
  entities: string[],
  userMessage: string,
  projectPath: string,
): Promise<GraphEntitySearchResult> {
  if (entities.length === 0) {
    console.log(
      "[MemoryPipeline] no entities to search, skipping graph search",
    );

    return {
      matches: [],
      foundCount: 0,
      totalMentionCount: 0,
      rankedTurns: [],
    };
  }

  const graphResult = await searchGraphEntities(
    entities,
    userMessage,
    projectPath,
  );

  console.log(
    `[MemoryPipeline] graph search: found ${graphResult.foundCount}/${graphResult.matches.length} entity/ies, ${graphResult.totalMentionCount} mention(s), ${graphResult.rankedTurns.length} ranked turn(s)`,
  );

  return graphResult;
}

/* -------------------------------------------------------------------------- */
/* Memory Formatting                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Formats one ranked Turn as a memory block. Primary Turns carry
 * their score, neighbor Turns are marked as direct context.
 */
function formatRankedTurn(
  rankedTurn: NonNullable<
    GraphEntitySearchResult["rankedTurns"]
  >[number],
): string {
  if (rankedTurn.isNeighbor) {
    return [
      `  [neighbor ${rankedTurn.neighborDirection} of turn ${rankedTurn.neighborOfTurnId}, similarity: ${rankedTurn.neighborSimilarity?.toFixed(3)}]`,
      `  user: ${rankedTurn.userMessage}`,
      `  agent: ${rankedTurn.agentResponse}`,
    ].join("\n");
  }

  const score = rankedTurn.score;

  return [
    `  [turn ${rankedTurn.turnId}, entity score: ${score?.entityScore.toFixed(3)}, similarity: ${score?.similarityScore.toFixed(3)}, final: ${score?.finalScore.toFixed(3)}]`,
    `  user: ${rankedTurn.userMessage}`,
    `  agent: ${rankedTurn.agentResponse}`,
  ].join("\n");
}

/**
 * Formats the graph search result as a prompt-ready memory section.
 *
 * Returns an empty string when there is no result or no ranked Turn.
 */
export function formatGraphResultAsMemory(
  graphResult: GraphEntitySearchResult | null,
): string {
  if (!graphResult || graphResult.rankedTurns.length === 0) {
    return "";
  }

  const foundEntities = graphResult.matches
    .filter((match) => match.found)
    .map(
      (match) =>
        `${match.normalized} [${match.entityType}, ${match.mentionCount} mention(s)]`,
    );

  const turnBlocks = graphResult.rankedTurns.map(
    (rankedTurn) => formatRankedTurn(rankedTurn),
  );

  return [
    "RELATED MEMORY (PREVIOUS PROJECT CONVERSATIONS)",
    "",
    "The text below was retrieved from the stored memory of previous conversations in this project because it is related to the current request.",
    "It is real previous context from this project — use it when it is relevant, especially for questions about earlier messages, decisions, or code.",
    "It is not part of the current live conversation.",
    "Trust the current user request and the tool results over this memory when they conflict.",
    "Do not claim that this memory comes from the current conversation.",
    "",
    "---",
    "Matched entities:",
    foundEntities.map((entity) => `  • ${entity}`).join("\n"),
    "",
    "Related conversation turns (most relevant first):",
    turnBlocks.join("\n\n"),
    "---",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runs the complete entity memory pipeline for one user message as
 * a simple sequential pipeline:
 *
 *   init database -> extract entities -> search graph -> build memory
 *
 * @param userMessage The current user message.
 * @param projectPath The active project ROOT folder. The storage
 *   layer appends ".mocu/storage/memoryx.db" and
 *   ".mocu/storage/memory-graph.db" itself, so this must NOT include
 *   the .mocu/storage part.
 * @returns The pipeline result: `memoryContext` (ready-to-inject
 *   memory text, empty when nothing was found), plus the extracted
 *   `entities` and the raw `graphResult`.
 */
export async function runMemoryPipeline(
  userMessage: string,
  projectPath: string,
): Promise<MemoryPipelineResult> {
  const normalizedUserMessage =
    userMessage.trim();

  const normalizedProjectPath =
    projectPath.trim();

  if (!normalizedUserMessage) {
    throw new Error(
      "The current user message cannot be empty.",
    );
  }

  if (!normalizedProjectPath) {
    throw new Error(
      "The project folder path cannot be empty.",
    );
  }

  // Step 1: bind the entity store + graph index to the project.
  const entityDatabasePath =
    await initDatabaseStep(normalizedProjectPath);

  // Step 2: extract entities from the user message.
  const entities =
    await extractEntitiesStep(normalizedUserMessage);

  // Step 3: search the graph database for the entities.
  const graphResult =
    await searchGraphStep(
      entities,
      normalizedUserMessage,
      normalizedProjectPath,
    );

  // Step 4: format the ranked turns as the memory context.
  const memoryContext =
    formatGraphResultAsMemory(graphResult);

  console.log(
    `[MemoryPipeline] memory context length: ${memoryContext.length}`,
  );

  return {
    userMessage: normalizedUserMessage,
    projectPath: normalizedProjectPath,
    entityDatabasePath,
    entities,
    graphResult,
    memoryContext,
  };
}