// memory-retrieval/continuityAnalyzer.ts

import Database from "@tauri-apps/plugin-sql";

import { getAsyncLLM } from "../../../../services/ai/llm";
import { CONTEXT_GATE_PROMPT } from "./prompts";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface TurnRecordRow {
  record_key: string;
  payload: string;
}

interface TurnPayload {
  userMessage?: unknown;
  agentResponse?: unknown;
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

interface ConversationTurn {
  userMessage: string;
  agentResponse: string;
}

export interface ContinuityAnalysis {
  /**
   * The current user message that was classified.
   */
  userMessage: string;

  /**
   * The last turn read from the SQLite database, or null when the
   * database contains no turn records yet.
   */
  lastTurn: ConversationTurn | null;

  /**
   * Raw LLM response text (JSON string: context_requirement +
   * confidence + memory_query).
   */
  llmResponse: string;
}

/**
 * Reads the most recently persisted Turn from the SQLite
 * database at the given location.
 *
 * Returns the last turn (user message + agent response), or null
 * when the database contains no turn records yet.
 */
async function readLastTurn(
  databasePath: string,
): Promise<ConversationTurn | null> {
  const normalizedPath =
    normalizeDatabasePath(databasePath);

  const database =
    await Database.load(`sqlite:${normalizedPath}`);

  try {
    const rows =
      await database.select<TurnRecordRow[]>(`
        SELECT
          record_key,
          payload
        FROM records
        WHERE record_type = 'turn'
        ORDER BY
          created_at DESC,
          record_key DESC
        LIMIT 1
      `);

    const row = rows[0];

    if (!row) {
      return null;
    }

    let payload: TurnPayload;

    try {
      payload = JSON.parse(row.payload) as TurnPayload;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw new Error(
        `The last turn record contains invalid JSON: ${message}`,
      );
    }

    const userMessage =
      typeof payload.userMessage === "string"
        ? payload.userMessage
        : "";

    const agentResponse =
      typeof payload.agentResponse === "string"
        ? payload.agentResponse
        : "";

    if (!userMessage) {
      throw new Error(
        `The last turn record has no user message: ${row.record_key}`,
      );
    }

    return { userMessage, agentResponse };
  } finally {
    try {
      await database.close();
    } catch {
      // Ignore close errors; the read result is already available.
    }
  }
}

/* -------------------------------------------------------------------------- */
/* LLM Continuity Analysis                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Classifies the current user message using the LLM
 * (CONTEXT_GATE_PROMPT): the message is sent as "current_message"
 * and the last turn read from the SQLite database at the given
 * location is sent as "previous_turn" (user message + agent
 * response, null when the database has no turns yet).
 *
 * Returns the current user message, the last turn, and the raw
 * LLM response text (JSON string: context_requirement +
 * confidence + memory_query).
 */
export async function analyzeContinuity(
  userMessage: string,
  databasePath: string,
): Promise<ContinuityAnalysis> {
  const normalizedUserMessage = userMessage.trim();

  if (!normalizedUserMessage) {
    throw new Error(
      "The current user message cannot be empty.",
    );
  }

  const lastTurn =
    await readLastTurn(databasePath);

  const turnContext = JSON.stringify({
    current_message: normalizedUserMessage,
    previous_turn: lastTurn
      ? {
          user_message: lastTurn.userMessage,
          assistant_response:
            lastTurn.agentResponse,
        }
      : null,
  });

  const llm = await getAsyncLLM("expensive", {
    temperature: 0,
  });

  const response = await llm.invoke([
    {
      role: "system",
      content: CONTEXT_GATE_PROMPT,
    },
    {
      role: "user",
      content: turnContext,
    },
  ]);

  const llmResponse = extractResponseText(response);

  return {
    userMessage: normalizedUserMessage,
    lastTurn,
    llmResponse,
  };
}

function extractResponseText(
  response: { content: unknown },
): string {
  const content = response.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : typeof (block as { text?: unknown })?.text ===
              "string"
            ? (block as { text: string }).text
            : "",
      )
      .filter(Boolean)
      .join("\n");
  }

  return "";
}
