// memory-retrieval/memoryQuery.ts

import { getAsyncLLM } from "../../../../services/ai/llm";
import {
  extractJSONObject,
  getLLMResponseText,
} from "../window/llmResponse";
import {
  MEMORY_QUERY_SYSTEM_PROMPT,
  createMemoryQueryUserPrompt,
} from "./memoryQuery.prompt.js";

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

export type MemoryEntityType =
  (typeof MEMORY_ENTITY_TYPES)[number];

export const TEMPORAL_RELATIONS = [
  "EXACT",
  "BEFORE",
  "AFTER",
  "BETWEEN",
  "RECENT",
  "FIRST",
  "LAST",
  "UNKNOWN",
] as const;

export type TemporalRelation =
  (typeof TEMPORAL_RELATIONS)[number];

export interface MemoryQueryEntity {
  name: string;
  normalizedName: string;
  type: MemoryEntityType;
}

export interface MemoryTemporalConstraint {
  expression: string;
  relation: TemporalRelation;
  startDate: string | null;
  endDate: string | null;
}

export interface MemoryRetrievalQuery {
  semanticQuery: string;
  keywords: string[];
  entities: MemoryQueryEntity[];
  temporalConstraints: MemoryTemporalConstraint[];
}

export interface BuildMemoryQueryOptions {
  currentDate?: Date;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
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

function normalizeDate(
  value: unknown,
): string | null {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : null;
}

function normalizeTemporalConstraints(
  constraints: unknown,
): MemoryTemporalConstraint[] {
  if (!Array.isArray(constraints)) {
    return [];
  }

  const relations: readonly string[] =
    TEMPORAL_RELATIONS;
  const result: MemoryTemporalConstraint[] = [];

  for (const constraint of constraints) {
    if (!isRecord(constraint)) {
      continue;
    }

    const expression =
      typeof constraint.expression === "string"
        ? constraint.expression.trim()
        : "";

    if (!expression) {
      continue;
    }

    const relation =
      typeof constraint.relation === "string" &&
      relations.includes(constraint.relation)
        ? (constraint.relation as TemporalRelation)
        : "UNKNOWN";

    result.push({
      expression,
      relation,
      startDate: normalizeDate(
        constraint.startDate,
      ),
      endDate: normalizeDate(
        constraint.endDate,
      ),
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
    temporalConstraints:
      normalizeTemporalConstraints(
        value.temporalConstraints,
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Memory Query                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Builds a retrieval query for the MEMORY route.
 *
 * This function analyzes only the current user message.
 * It does not use the previous turn and does not perform retrieval.
 */
export async function buildMemoryQuery(
  userMessage: string,
  options: BuildMemoryQueryOptions = {},
): Promise<MemoryRetrievalQuery> {
  const normalizedMessage = userMessage.trim();

  if (!normalizedMessage) {
    throw new Error(
      "userMessage cannot be empty.",
    );
  }

  const currentDate =
    options.currentDate ?? new Date();

  const llm = await getAsyncLLM("expensive", {
    temperature: 0,
  });

  const response = await llm.invoke([
    {
      role: "system",
      content: MEMORY_QUERY_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: createMemoryQueryUserPrompt(
        normalizedMessage,
        currentDate.toISOString(),
      ),
    },
  ]);

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
