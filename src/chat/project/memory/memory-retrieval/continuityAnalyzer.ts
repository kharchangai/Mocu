// memory-retrieval/continuityAnalyzer.ts

import Database from "@tauri-apps/plugin-sql";

import { getAsyncLLM } from "../../../../services/ai/llm";
import {
  extractJSONObject,
  getLLMResponseText,
} from "../window/llmResponse";
import { CONTEXT_GATE_PROMPT } from "./prompts";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Context routes the LLM gate can select for the current user
 * message (see CONTEXT_GATE_PROMPT).
 */
export const CONTEXT_REQUIREMENTS = [
  "NONE",
  "PREVIOUS_TURN",
  "MEMORY",
  "PREVIOUS_TURN_AND_MEMORY",
] as const;

export type ContextRequirement =
  (typeof CONTEXT_REQUIREMENTS)[number];

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

export interface ConversationTurn {
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
   * Parsed context requirement chosen by the LLM gate.
   */
  contextRequirement: ContextRequirement;

  /**
   * Confidence of the classification (0 to 1).
   */
  confidence: number;

  /**
   * Raw LLM response text (JSON string: context_requirement +
   * confidence).
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
export async function readLastTurn(
  databasePath: string,
): Promise<ConversationTurn | null> {
  const normalizedPath =
    normalizeDatabasePath(databasePath);

  const database =
    await Database.load(`sqlite:${normalizedPath}`);

  /*
   * No database.close() here: the Tauri SQL plugin keeps one pool per
   * connection string, and close() without a database name closes
   * every pool — including the shared databaseManager's pool.
   * Database.load always replaces the pool, so leaving it open is
   * safe.
   */
  {
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
  }
}

/* -------------------------------------------------------------------------- */
/* LLM Continuity Analysis                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Parses the raw LLM gate response (JSON object with
 * "context_requirement" and "confidence") and validates both fields.
 */
function parseContextRequirement(
  llmResponse: string,
): {
  contextRequirement: ContextRequirement;
  confidence: number;
} {
  const responseText = llmResponse.trim();

  if (!responseText) {
    throw new Error(
      "The LLM returned an empty response.",
    );
  }

  const jsonText = extractJSONObject(responseText);

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      "The LLM response could not be parsed as JSON.",
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "The LLM gate response is not an object.",
    );
  }

  const record = parsed as Record<string, unknown>;

  const requirement = record.context_requirement;

  if (
    typeof requirement !== "string" ||
    !CONTEXT_REQUIREMENTS.includes(
      requirement as ContextRequirement,
    )
  ) {
    throw new Error(
      `The LLM returned an unknown context_requirement: ${String(
        requirement,
      )}`,
    );
  }

  const confidence = record.confidence;

  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error(
      `The LLM returned an invalid confidence: ${String(
        confidence,
      )}`,
    );
  }

  return {
    contextRequirement:
      requirement as ContextRequirement,
    confidence,
  };
}

/**
 * Classifies the current user message using the LLM
 * (CONTEXT_GATE_PROMPT): the message is sent as "current_message"
 * and the last turn read from the SQLite database at the given
 * location is sent as "previous_turn" (user message + agent
 * response, null when the database has no turns yet).
 *
 * Returns the current user message, the last turn, the parsed
 * context requirement with its confidence, and the raw LLM response
 * text (JSON string: context_requirement + confidence).
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

  const llm = await getAsyncLLM("cheap", {
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

  const llmResponse = getLLMResponseText(response);

  const { contextRequirement, confidence } =
    parseContextRequirement(llmResponse);

  return {
    userMessage: normalizedUserMessage,
    lastTurn,
    contextRequirement,
    confidence,
    llmResponse,
  };
}
