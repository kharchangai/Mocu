import { getAsyncLLM } from "../../../../services/ai/llm";
import {
  extractJSONObject,
  getLLMResponseText,
} from "../window/llmResponse";
import {
  MEMORY_QUERY_SYSTEM_PROMPT,
  PREVIOUS_TURN_AND_MEMORY_QUERY_SYSTEM_PROMPT,
  createMemoryQueryUserPrompt,
  createPreviousTurnAndMemoryQueryUserPrompt,
} from "./memoryQuery.prompt";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const MEMORY_QUERY_MODES = [
  "MEMORY",
  "PREVIOUS_TURN_AND_MEMORY",
] as const;

export const MEMORY_ENTITY_TYPES = [
  "PERSON",
  "ORGANIZATION",
  "PROJECT",
  "PRODUCT",
  "APPLICATION",
  "TECHNOLOGY",
  "DATABASE",
  "FILE",
  "FUNCTION",
  "LOCATION",
  "DATE",
  "EVENT",
  "CONCEPT",
  "OTHER",
] as const;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type MemoryQueryMode =
  (typeof MEMORY_QUERY_MODES)[number];

export type MemoryEntityType =
  (typeof MEMORY_ENTITY_TYPES)[number];

export interface MemoryQueryEntity {
  name: string;
  normalizedName: string;
  type: MemoryEntityType;
}

export interface MemoryRetrievalQuery {
  semanticQuery: string;
  keywords: string[];
  entities: MemoryQueryEntity[];
}

export interface PreviousTurn {
  userMessage: string;
  agentResponse: string;
}

export interface MemoryOnlyQueryInput {
  mode: "MEMORY";
  userMessage: string;
}

export interface PreviousTurnAndMemoryQueryInput {
  mode: "PREVIOUS_TURN_AND_MEMORY";
  userMessage: string;
  previousTurn: PreviousTurn;
}

export type BuildMemoryQueryInput =
  | MemoryOnlyQueryInput
  | PreviousTurnAndMemoryQueryInput;

interface MemoryQueryPrompts {
  systemPrompt: string;
  userPrompt: string;
}

/* -------------------------------------------------------------------------- */
/* General helpers                                                            */
/* -------------------------------------------------------------------------- */

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function normalizeRequiredText(
  value: string,
  fieldName: string,
): string {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new Error(`${fieldName} cannot be empty.`);
  }

  return normalizedValue;
}

/* -------------------------------------------------------------------------- */
/* Result normalization                                                       */
/* -------------------------------------------------------------------------- */

function normalizeKeywords(
  keywords: unknown,
): string[] {
  if (!Array.isArray(keywords)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const keyword of keywords) {
    if (typeof keyword !== "string") {
      continue;
    }

    const value = keyword.trim();

    if (!value) {
      continue;
    }

    const normalizedValue =
      value.toLocaleLowerCase();

    if (seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    result.push(value);
  }

  return result;
}

function normalizeEntities(
  entities: unknown,
): MemoryQueryEntity[] {
  if (!Array.isArray(entities)) {
    return [];
  }

  const seen = new Set<string>();
  const result: MemoryQueryEntity[] = [];
  const entityTypes: readonly string[] =
    MEMORY_ENTITY_TYPES;

  for (const entity of entities) {
    if (!isRecord(entity)) {
      continue;
    }

    const name =
      typeof entity.name === "string"
        ? entity.name.trim()
        : "";

    const normalizedName =
      typeof entity.normalizedName === "string"
        ? entity.normalizedName
            .trim()
            .toLocaleLowerCase()
        : "";

    const type =
      typeof entity.type === "string" &&
      entityTypes.includes(entity.type)
        ? (entity.type as MemoryEntityType)
        : null;

    if (!name || !normalizedName || !type) {
      continue;
    }

    const uniqueKey = `${type}:${normalizedName}`;

    if (seen.has(uniqueKey)) {
      continue;
    }

    seen.add(uniqueKey);

    result.push({
      name,
      normalizedName,
      type,
    });
  }

  return result;
}

function validateResult(
  value: unknown,
): MemoryRetrievalQuery {
  if (!isRecord(value)) {
    throw new Error(
      "The LLM memory query response is not an object.",
    );
  }

  const semanticQuery =
    typeof value.semanticQuery === "string"
      ? value.semanticQuery.trim()
      : "";

  if (!semanticQuery) {
    throw new Error(
      "The LLM returned an empty semanticQuery.",
    );
  }

  return {
    semanticQuery,
    keywords: normalizeKeywords(value.keywords),
    entities: normalizeEntities(value.entities),
  };
}

/* -------------------------------------------------------------------------- */
/* Prompt creation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Creates prompts for a query that only uses the current user message.
 */
function createMemoryOnlyPrompts(
  userMessage: string,
): MemoryQueryPrompts {
  return {
    systemPrompt: MEMORY_QUERY_SYSTEM_PROMPT,
    userPrompt:
      createMemoryQueryUserPrompt(userMessage),
  };
}

/**
 * Creates prompts for a query that uses both the previous turn and the
 * current user message.
 *
 * The previous turn is used to resolve references and omitted context.
 * The current user message remains the source of the retrieval goal.
 */
function createPreviousTurnAndMemoryPrompts(
  previousTurn: PreviousTurn,
  userMessage: string,
): MemoryQueryPrompts {
  const previousUserMessage =
    normalizeRequiredText(
      previousTurn.userMessage,
      "previousTurn.userMessage",
    );

  const previousAgentResponse =
    normalizeRequiredText(
      previousTurn.agentResponse,
      "previousTurn.agentResponse",
    );

  return {
    systemPrompt:
      PREVIOUS_TURN_AND_MEMORY_QUERY_SYSTEM_PROMPT,

    userPrompt:
      createPreviousTurnAndMemoryQueryUserPrompt(
        {
          userMessage: previousUserMessage,
          agentResponse: previousAgentResponse,
        },
        userMessage,
      ),
  };
}

/**
 * Selects the correct prompt strategy based on the query mode.
 */
function createQueryPrompts(
  input: BuildMemoryQueryInput,
  normalizedUserMessage: string,
): MemoryQueryPrompts {
  switch (input.mode) {
    case "MEMORY":
      return createMemoryOnlyPrompts(
        normalizedUserMessage,
      );

    case "PREVIOUS_TURN_AND_MEMORY":
      return createPreviousTurnAndMemoryPrompts(
        input.previousTurn,
        normalizedUserMessage,
      );

    default: {
      const exhaustiveCheck: never = input;

      throw new Error(
        `Unsupported memory query input: ${String(
          exhaustiveCheck,
        )}`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* LLM response parsing                                                       */
/* -------------------------------------------------------------------------- */

function parseMemoryQueryResponse(
  response: unknown,
): MemoryRetrievalQuery {
  const responseText =
    getLLMResponseText(response);

  if (!responseText.trim()) {
    throw new Error(
      "The LLM returned an empty response.",
    );
  }

  const jsonText =
    extractJSONObject(responseText);

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      "The LLM response could not be parsed as JSON.",
    );
  }

  return validateResult(parsed);
}

/* -------------------------------------------------------------------------- */
/* Memory Query                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Builds a query for long-term memory retrieval.
 *
 * MEMORY:
 * Uses only the current user message.
 *
 * PREVIOUS_TURN_AND_MEMORY:
 * Uses the previous user message, previous agent response, and current user
 * message. The previous turn supplies only the context required to understand
 * the current retrieval request.
 *
 * This function builds the query but does not perform memory retrieval.
 */
export async function buildMemoryQuery(
  input: BuildMemoryQueryInput,
): Promise<MemoryRetrievalQuery> {
  const normalizedUserMessage =
    normalizeRequiredText(
      input.userMessage,
      "userMessage",
    );

  const {
    systemPrompt,
    userPrompt,
  } = createQueryPrompts(
    input,
    normalizedUserMessage,
  );

  const llm = await getAsyncLLM("expensive", {
    temperature: 0,
  });

  const response = await llm.invoke([
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: userPrompt,
    },
  ]);

  return parseMemoryQueryResponse(response);
}