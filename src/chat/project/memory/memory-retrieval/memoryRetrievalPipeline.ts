// memory-retrieval/memoryRetrievalPipeline.ts

/**
 * Retrieval pipeline of the project memory system.
 *
 * User message + SQLite database location
 *   -> ContinuityAnalysis     (continuityAnalyzer, context gate)
 *   -> NONE                  -> no retrieval
 *   -> PREVIOUS_TURN         -> last Turn of the last Window of the
 *                              last Episode (turnEvidenceSearchEngine)
 *   -> MEMORY                -> best Episode   (episodeSearchEngine)
 *                              -> best Window  (windowSearchEngine)
 *                              -> best Turns + related neighbor Turns
 *                                 + Spans        (turnEvidenceSearchEngine)
 *   -> PREVIOUS_TURN_AND_MEMORY -> same search, but the previous turn
 *                                  is included in the memory query
 *                              -> RelatedMemory
 *
 * The pipeline is executed by the project agent on every user message.
 * When related memory is found, its ready-to-use contextText is added
 * to the agent context (system prompt).
 */

import {
  findBestTurnEvidence,
  findLastTurnEvidence,
  type TurnEvidenceSearchOptions,
  type TurnEvidenceSearchResult,
} from "./turnEvidenceSearchEngine";
import {
  analyzeContinuity,
  type ConversationTurn,
} from "./continuityAnalyzer";

/* -------------------------------------------------------------------------- */
/* Storage Location                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Location of the SQLite database of a user-selected project folder.
 *
 * Mirrors the project storage of the database manager:
 *
 * <projectPath>/.mocu/storage/memory.db
 */
const PROJECT_STORAGE_DIRECTORY = ".mocu/storage";
const PROJECT_DATABASE_FILE = "memory.db";

/**
 * Returns the SQLite database file location of a project folder.
 *
 * Each project owns its own database file, therefore the retrieval
 * pipeline always reads from the database of the active project.
 */
export function getProjectDatabasePath(
  projectPath: string,
): string {
  const normalizedProjectPath = projectPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  if (!normalizedProjectPath) {
    throw new Error(
      "The project folder path cannot be empty.",
    );
  }

  return [
    normalizedProjectPath,
    PROJECT_STORAGE_DIRECTORY,
    PROJECT_DATABASE_FILE,
  ].join("/");
}

/* -------------------------------------------------------------------------- */
/* Public Types                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Related long-term memory for the current user message.
 */
export type RelatedMemory =
  TurnEvidenceSearchResult;

/* -------------------------------------------------------------------------- */
/* Pipeline                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Runs the complete memory retrieval pipeline for one user message.
 *
 * 1. Classifies the user message with the continuity analyzer
 *    (context gate LLM).
 * 2. Routes by the selected context requirement:
 *    - NONE: the message is self-contained, no memory is returned.
 *    - PREVIOUS_TURN: the last turn of the database is returned
 *      directly (findLastTurnEvidence) without any search.
 *    - MEMORY: the full hierarchical search runs with the current
 *      user message only.
 *    - PREVIOUS_TURN_AND_MEMORY: the full hierarchical search runs
 *      with the previous turn included in the memory query.
 *
 * Returns null when the gate selects NONE or when no related memory
 * exists above the minimum scores.
 *
 * @param userMessage The current user message.
 * @param databasePath Location of the SQLite database file.
 * @param options Optional turn selection and token budget options.
 */
export async function retrieveRelatedMemory(
  userMessage: string,
  databasePath: string,
  options: TurnEvidenceSearchOptions = {},
): Promise<RelatedMemory | null> {
  const normalizedUserMessage =
    userMessage.trim();

  if (!normalizedUserMessage) {
    return null;
  }

  const normalizedDatabasePath =
    databasePath.trim();

  if (!normalizedDatabasePath) {
    return null;
  }

  /*
   * The continuity analysis (context gate) decides which context
   * sources the current user message requires.
   */
  const analysis = await analyzeContinuity(
    normalizedUserMessage,
    normalizedDatabasePath,
  );

  console.log(
    "[Memory Retrieval] Continuity gate:",
    {
      requirement: analysis.contextRequirement,
      confidence: analysis.confidence,
      hasLastTurn: analysis.lastTurn !== null,
    },
  );

  let result: RelatedMemory | null = null;

  switch (analysis.contextRequirement) {
    case "NONE":
      break;

    case "PREVIOUS_TURN":
      result = await findLastTurnEvidence(
        normalizedDatabasePath,
        options,
      );
      break;

    case "MEMORY":
      result = await findBestTurnEvidence(
        {
          mode: "MEMORY",
          userMessage: normalizedUserMessage,
        },
        normalizedDatabasePath,
        options,
      );
      break;

    case "PREVIOUS_TURN_AND_MEMORY": {
      /*
       * The gate prompt forbids selecting this route when no
       * previous turn exists; fall back to MEMORY mode as a
       * safeguard.
       */
      const previousTurn:
        ConversationTurn | null =
        analysis.lastTurn;

      result = await findBestTurnEvidence(
        previousTurn
          ? {
              mode: "PREVIOUS_TURN_AND_MEMORY",
              userMessage:
                normalizedUserMessage,
              previousTurn,
            }
          : {
              mode: "MEMORY",
              userMessage:
                normalizedUserMessage,
            },
        normalizedDatabasePath,
        options,
      );
      break;
    }
  }

  if (result) {
    console.log(
      "[Memory Retrieval] Related memory found:",
      {
        route: analysis.contextRequirement,
        episodeId: result.episode.episodeId,
        windowId: result.window.windowId,
        turns: result.turns.length,
        estimatedTokens: result.estimatedTokens,
        wasRefinedToSpans:
          result.wasRefinedToSpans,
      },
    );

    console.log(
      "[Memory Retrieval] Memory context text:\n" +
        result.contextText,
    );
  } else {
    console.log(
      "[Memory Retrieval] No related memory returned:",
      {
        route: analysis.contextRequirement,
      },
    );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Agent Context Formatting                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Formats the related memory as a prompt section for the project
 * agent system prompt.
 *
 * Returns an empty string when there is no memory or no context text.
 */
export function buildRelatedMemoryPrompt(
  memory: RelatedMemory | null,
): string {
  if (!memory || !memory.contextText.trim()) {
    return "";
  }

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
    memory.contextText.trim(),
    "---",
  ].join("\n");
}
