// extractMessageEntities.ts

import { getAsyncLLM } from "../../../../services/ai/llm";

import type { TurnEntity } from "../createTurn";

import { EntityMemoryStore } from "./entityMemoryStore";

import type {
  ExistingEntityMatch,
} from "./entityMemoryStore";

import {
  createEntitySearchPrompt,
} from "./createEntitySearchPrompt";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const ENTITY_SEARCH_LOG_PREFIX =
  "[EntitySearch]";

const ENTITY_SEARCH_LOGGING_ENABLED =
  true;

/**
 * Minimum semantic similarity required for accepting an existing
 * database entity as a match.
 */
const ENTITY_MATCH_THRESHOLD = 0.8;

/* -------------------------------------------------------------------------- */
/* Console Logging                                                            */
/* -------------------------------------------------------------------------- */

function logEntitySearch(
  message: string,
): void {
  if (!ENTITY_SEARCH_LOGGING_ENABLED) {
    return;
  }

  console.info(
    `${ENTITY_SEARCH_LOG_PREFIX} ${message}`,
  );
}

function logEntitySearchWarning(
  message: string,
): void {
  if (!ENTITY_SEARCH_LOGGING_ENABLED) {
    return;
  }

  console.warn(
    `${ENTITY_SEARCH_LOG_PREFIX} ${message}`,
  );
}

function logEntitySearchError(
  message: string,
  error: unknown,
): void {
  if (!ENTITY_SEARCH_LOGGING_ENABLED) {
    return;
  }

  console.error(
    `${ENTITY_SEARCH_LOG_PREFIX} ${message}`,
    error,
  );
}

/* -------------------------------------------------------------------------- */
/* Entity Search Store                                                        */
/* -------------------------------------------------------------------------- */

/**
 * This store is used only to search entities that already exist in
 * the SQLite entity database.
 *
 * matchExistingEntities() must be read-only:
 *
 * - It may read stored entities.
 * - It may create query embeddings temporarily in memory.
 * - It must not insert entities.
 * - It must not update entities.
 * - It must not call processEntities().
 * - It must not return unmatched query entities.
 */
const entitySearchStore =
  new EntityMemoryStore({
    similarityThreshold:
      ENTITY_MATCH_THRESHOLD,
  });

/**
 * Selects the entity database associated with the active project.
 */
export async function useMessageEntityDatabase(
  projectPath: string | null,
): Promise<string> {
  return entitySearchStore.useProjectDatabase(
    projectPath,
  );
}

/* -------------------------------------------------------------------------- */
/* Public Entity Extraction                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Extracts entity candidates from a user message and resolves them
 * strictly against entities that already exist in SQLite.
 *
 * Important rules:
 *
 * 1. LLM entities are only search queries.
 * 2. Raw LLM entities are never returned.
 * 3. Unmatched LLM entities are completely removed.
 * 4. Only canonical values returned from the database are accepted.
 * 5. This function never stores a new entity.
 * 6. If extraction or database matching fails, [] is returned.
 */
export async function extractEntities(
  userMessage: string,
): Promise<string[]> {
  const message =
    normalizeMessage(userMessage);

  if (!message) {
    logEntitySearch(
      "extractEntities: empty message, returning []",
    );

    return [];
  }

  logEntitySearch(
    `extractEntities: start (message length: ${message.length})`,
  );

  try {
    /*
     * Step 1:
     * Ask the LLM to extract candidate entities.
     *
     * These candidates are not trusted and will not be returned directly.
     */
    const llmCandidates =
      await extractEntitiesWithLLM(
        message,
      );

    logEntitySearch(
      `extractEntities: LLM returned ${llmCandidates.length} candidate entity/ies: ${JSON.stringify(llmCandidates)}`,
    );

    if (llmCandidates.length === 0) {
      logEntitySearch(
        "extractEntities: no LLM candidates, returning []",
      );

      return [];
    }

    /*
     * Step 2:
     * Convert LLM candidates to temporary query entities.
     *
     * These objects exist only in memory and are not stored.
     */
    const queryEntities: TurnEntity[] =
      llmCandidates
        .map((candidate) => {
          const normalized =
            normalizeEntity(
              candidate,
            );

          return {
            text: normalized,
            normalized,
            type: "other" as const,
          };
        })
        .filter(
          (entity) =>
            entity.normalized.length > 0,
        );

    if (queryEntities.length === 0) {
      logEntitySearch(
        "extractEntities: all LLM candidates were empty after normalization",
      );

      return [];
    }

    /*
     * Step 3:
     * Search only the entities already stored in the database.
     */
    let databaseMatches:
      ExistingEntityMatch[];

    try {
      logEntitySearch(
        `extractEntities: matching ${queryEntities.length} query entity/ies against existing database entities (ignoreQueryType: true, threshold: ${ENTITY_MATCH_THRESHOLD})`,
      );

      const matches =
        await entitySearchStore.matchExistingEntities(
          queryEntities,
          {
            /*
             * The extraction prompt currently does not return reliable
             * entity types, so queries must be compared against all
             * stored entity types.
             */
            ignoreQueryType: true,

            similarityThreshold:
              ENTITY_MATCH_THRESHOLD,
          },
        );

      databaseMatches =
        Array.isArray(matches)
          ? matches
          : [];
    } catch (error) {
      logEntitySearchError(
        "extractEntities: database entity matching failed",
        error,
      );

      /*
       * Never fall back to raw LLM entities.
       */
      return [];
    }

    logEntitySearch(
      `extractEntities: database returned ${databaseMatches.length} match/es: ${JSON.stringify(databaseMatches)}`,
    );

    if (databaseMatches.length === 0) {
      logEntitySearch(
        "extractEntities: none of the LLM entities exist in the database",
      );

      return [];
    }

    /*
     * Step 4:
     * Apply another defensive validation layer.
     *
     * Even if matchExistingEntities() accidentally returns malformed or
     * low-score results, they will not enter the final output.
     */
    const acceptedMatches =
      databaseMatches.filter(
        isAcceptedDatabaseMatch,
      );

    if (acceptedMatches.length === 0) {
      logEntitySearch(
        "extractEntities: database matches were rejected by final validation",
      );

      return [];
    }

    /*
     * Step 5:
     * Return only canonical normalized values received from database
     * matches.
     *
     * No value is read from llmCandidates here.
     */
    const finalEntities =
      uniqueStrings(
        acceptedMatches.map(
          (match) =>
            match.normalized,
        ),
      );

    logEntitySearch(
      `extractEntities: done, returning ${finalEntities.length} database entity/ies: ${JSON.stringify(finalEntities)}`,
    );

    return finalEntities;
  } catch (error) {
    logEntitySearchError(
      "extractEntities: unexpected extraction failure",
      error,
    );

    /*
     * Fail closed:
     * The database is the source of truth, so do not return LLM output.
     */
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Database Match Validation                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Final defensive validation for values returned by
 * matchExistingEntities().
 */
function isAcceptedDatabaseMatch(
  match: ExistingEntityMatch,
): boolean {
  if (
    typeof match !== "object" ||
    match === null
  ) {
    return false;
  }

  if (
    typeof match.normalized !==
      "string" ||
    normalizeEntity(
      match.normalized,
    ).length === 0
  ) {
    return false;
  }

  if (
    typeof match.similarity !==
      "number" ||
    !Number.isFinite(
      match.similarity,
    )
  ) {
    return false;
  }

  return (
    match.similarity >=
    ENTITY_MATCH_THRESHOLD
  );
}

/* -------------------------------------------------------------------------- */
/* LLM Extraction                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Extracts candidate entity strings using the LLM.
 *
 * The returned strings are only temporary search queries. They must
 * never be returned to the caller before database matching.
 */
async function extractEntitiesWithLLM(
  message: string,
): Promise<string[]> {
  logEntitySearch(
    "extractEntitiesWithLLM: creating LLM client (cheap, temperature: 0)",
  );

  const llm =
    await getAsyncLLM(
      "expensive",
      {
        temperature: 0,
      },
    );

  logEntitySearch(
    "extractEntitiesWithLLM: invoking LLM",
  );

  const response =
    await llm.invoke(
      createEntitySearchPrompt(
        message,
      ),
    );

  logEntitySearch(
    `extractEntitiesWithLLM: response received (type: ${response?.constructor?.name ?? typeof response})`,
  );

  const content =
    extractMessageText(
      response.content,
    );

  logEntitySearch(
    `extractEntitiesWithLLM: response content (${content.length} chars): ${content.slice(0, 500)}`,
  );

  if (!content) {
    logEntitySearchWarning(
      "extractEntitiesWithLLM: LLM returned empty content",
    );

    return [];
  }

  const parsed =
    parseLLMJson(
      content,
    );

  if (
    !isRecord(parsed) ||
    !Array.isArray(
      parsed.entities,
    )
  ) {
    logEntitySearchWarning(
      "extractEntitiesWithLLM: invalid entities response",
    );

    return [];
  }

  return uniqueStrings(
    parsed.entities,
  );
}

/* -------------------------------------------------------------------------- */
/* LangChain Response Parsing                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Extracts plain text from a LangChain message response.
 */
function extractMessageText(
  content: unknown,
): string {
  if (
    typeof content === "string"
  ) {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (
        typeof block === "string"
      ) {
        return block;
      }

      if (
        isRecord(block) &&
        typeof block.text ===
          "string"
      ) {
        return block.text;
      }

      return "";
    })
    .filter(
      (text) =>
        text.trim().length > 0,
    )
    .join("\n")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* JSON Parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parses JSON returned by the LLM.
 *
 * It tolerates:
 *
 * - Plain JSON
 * - Markdown JSON fences
 * - Text around the JSON object
 */
function parseLLMJson(
  response: string,
): unknown {
  const cleanedResponse =
    response
      .trim()
      .replace(
        /^```(?:json)?\s*/i,
        "",
      )
      .replace(
        /\s*```$/i,
        "",
      )
      .trim();

  if (!cleanedResponse) {
    return null;
  }

  try {
    return JSON.parse(
      cleanedResponse,
    );
  } catch {
    const jsonText =
      extractFirstJsonObject(
        cleanedResponse,
      );

    if (!jsonText) {
      return null;
    }

    try {
      return JSON.parse(
        jsonText,
      );
    } catch {
      return null;
    }
  }
}

/**
 * Extracts the first balanced JSON object from arbitrary text.
 *
 * Braces appearing inside JSON strings are ignored.
 */
function extractFirstJsonObject(
  text: string,
): string | null {
  let startIndex = -1;
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (
    let index = 0;
    index < text.length;
    index += 1
  ) {
    const character =
      text[index];

    if (insideString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === '"') {
        insideString = false;
      }

      continue;
    }

    if (character === '"') {
      insideString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (character === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;

      if (
        depth === 0 &&
        startIndex !== -1
      ) {
        return text.slice(
          startIndex,
          index + 1,
        );
      }
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* String Normalization                                                       */
/* -------------------------------------------------------------------------- */

function normalizeMessage(
  value: string,
): string {
  return value.trim();
}

/**
 * Cleans, normalizes and deduplicates an array of unknown values.
 */
function uniqueStrings(
  values: unknown[],
): string[] {
  const seen =
    new Set<string>();

  const result: string[] = [];

  for (const value of values) {
    if (
      typeof value !== "string"
    ) {
      continue;
    }

    const normalizedValue =
      normalizeEntity(
        value,
      );

    if (!normalizedValue) {
      continue;
    }

    const comparisonKey =
      createComparisonKey(
        normalizedValue,
      );

    if (
      seen.has(comparisonKey)
    ) {
      continue;
    }

    seen.add(comparisonKey);
    result.push(normalizedValue);
  }

  return result;
}

/**
 * Normalizes entity text for matching and duplicate detection.
 */
function normalizeEntity(
  value: string,
): string {
  return value
    /*
     * Replace escaped zero-width character literals.
     */
    .replace(
      /\\u200c/gi,
      " ",
    )
    .replace(
      /\\u200d/gi,
      " ",
    )
    .replace(
      /\\u200b/gi,
      "",
    )

    /*
     * Replace actual ZWNJ and ZWJ characters.
     */
    .replace(
      /[\u200C\u200D]/g,
      " ",
    )

    /*
     * Remove zero-width spaces and byte-order marks.
     */
    .replace(
      /[\u200B\uFEFF]/g,
      "",
    )

    /*
     * Remove direction-control characters.
     */
    .replace(
      /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g,
      "",
    )

    /*
     * Apply stable Unicode normalization.
     */
    .normalize("NFKC")

    /*
     * Collapse repeated whitespace.
     */
    .replace(
      /\s+/g,
      " ",
    )
    .trim();
}

/**
 * Creates a key used only for duplicate detection.
 */
function createComparisonKey(
  value: string,
): string {
  return normalizeEntity(
    value,
  )
    .toLocaleLowerCase()
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Type Guards                                                                */
/* -------------------------------------------------------------------------- */

function isRecord(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
