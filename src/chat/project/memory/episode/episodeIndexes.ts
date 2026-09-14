// episode/episodeIndexes.ts

import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";
import type {
  MemoryWindow,
  WindowEntity,
} from "../window/types";
import {
  getErrorMessage,
  normalizeText,
  uniqueStrings,
} from "../window/helpers";
import type {
  EpisodeIndexes,
  EpisodeWindowSummary,
} from "./types";
import { createEpisodeSubject } from "./episodeSubject";

/* -------------------------------------------------------------------------- */
/* Entity Merging                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Merges entities using the existing normalized entity identity.
 *
 * Two entities are identical when their normalized value and their
 * type are equal. The first representation wins.
 */
export function mergeWindowEntities(
  entities: WindowEntity[],
): WindowEntity[] {
  const uniqueEntities = new Map<
    string,
    WindowEntity
  >();

  for (const entity of entities) {
    if (
      !entity ||
      typeof entity.text !== "string" ||
      !entity.text.trim()
    ) {
      continue;
    }

    const text = entity.text.trim();

    const normalized =
      typeof entity.normalized === "string" &&
      entity.normalized.trim()
        ? normalizeText(entity.normalized)
        : normalizeText(text);

    if (!normalized) {
      continue;
    }

    const identityKey = [
      normalized,
      entity.type,
    ].join(":");

    if (!uniqueEntities.has(identityKey)) {
      uniqueEntities.set(identityKey, {
        text,
        normalized,
        type: entity.type,
      });
    }
  }

  return Array.from(uniqueEntities.values());
}

/* -------------------------------------------------------------------------- */
/* Window Summaries                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates the compact summary of one Window for the LLM subject call.
 *
 * The last subject of a Window is its most recent main subject and is
 * used as the Window subject.
 */
export function createWindowSummary(
  window: MemoryWindow,
): EpisodeWindowSummary {
  const subjects =
    window.indexes.subjects;

  const subject =
    subjects[subjects.length - 1] ?? "";

  return {
    subject,
    keywords: uniqueStrings(
      window.indexes.keywords,
    ),
    types: uniqueStrings(
      window.indexes.types,
    ),
    entities: mergeWindowEntities(
      window.turns.flatMap(
        (turn) => turn.indexes.entities ?? [],
      ),
    ).map((entity) => entity.text),
  };
}

/* -------------------------------------------------------------------------- */
/* Embedding Text                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Builds the canonical Episode index text that is sent to the
 * embedding model.
 *
 * Ids, timestamps, status, and other metadata are not embedded.
 */
export function createEpisodeEmbeddingText(
  subject: string,
  subjects: string[],
  keywords: string[],
  types: string[],
  entities: string[],
): string {
  const windowSubjectLines = subjects.map(
    (windowSubject) => `- ${windowSubject}`,
  );

  return [
    `Subject: ${subject}`,
    "Window subjects:",
    ...windowSubjectLines,
    `Keywords: ${keywords.join(", ")}`,
    `Types: ${types.join(", ")}`,
    `Entities: ${entities.join(", ")}`,
  ].join("\n");
}

async function buildEpisodeEmbedding(
  subject: string,
  subjects: string[],
  keywords: string[],
  types: string[],
  entities: string[],
): Promise<number[]> {
  const embeddingText =
    createEpisodeEmbeddingText(
      subject,
      subjects,
      keywords,
      types,
      entities,
    );

  try {
    return await textSimilarity.embedText(
      embeddingText,
    );
  } catch (error) {
    throw new Error(
      `Could not create the Episode embedding: ${getErrorMessage(error)}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Index Management                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds the indexes of an Episode from the indexes of its member
 * Windows.
 *
 * - subjects, keywords, and types are unique unions in original order.
 * - entities are merged with the normalized entity identity.
 * - the general subject is created by the LLM from compact Window
 *   summaries.
 * - the embedding is created from the combination of all index fields.
 */
export async function buildEpisodeIndexes(
  windows: MemoryWindow[],
): Promise<EpisodeIndexes> {
  if (windows.length === 0) {
    throw new Error(
      "Episode indexes require at least one Window.",
    );
  }

  const subjects = uniqueStrings(
    windows.flatMap(
      (window) => window.indexes.subjects,
    ),
  );

  if (subjects.length === 0) {
    throw new Error(
      "Episode indexes require at least one Window subject.",
    );
  }

  const keywords = uniqueStrings(
    windows.flatMap(
      (window) => window.indexes.keywords,
    ),
  );

  const types = uniqueStrings(
    windows.flatMap(
      (window) => window.indexes.types,
    ),
  );

  const entities = mergeWindowEntities(
    windows.flatMap((window) =>
      window.turns.flatMap(
        (turn) => turn.indexes.entities ?? [],
      ),
    ),
  );

  const windowSummaries = windows.map(
    createWindowSummary,
  );

  const subject =
    await createEpisodeSubject(windowSummaries);

  const embedding =
    await buildEpisodeEmbedding(
      subject,
      subjects,
      keywords,
      types,
      entities.map(
        (entity) => entity.text,
      ),
    );

  return {
    subject,
    subjects,
    keywords,
    types,
    entities,
    embedding,
  };
}
