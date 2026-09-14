// episode/episodeMatching.ts

import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";
import type { MemoryWindow } from "../window/types";
import {
  clamp,
  normalizeText,
  uniqueStrings,
} from "../window/helpers";
import type {
  EpisodeCandidateScore,
  EpisodeManagerConfig,
  MemoryEpisode,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compares the Window embedding with the Episode embedding.
 *
 * A dimension mismatch or an empty embedding contributes no evidence
 * instead of failing the whole match.
 */
function calculateEmbeddingSimilarity(
  window: MemoryWindow,
  episode: MemoryEpisode,
): number {
  if (
    window.indexes.embedding.length === 0 ||
    episode.indexes.embedding.length === 0
  ) {
    return 0;
  }

  try {
    return clamp(
      textSimilarity.compareEmbeddingToEmbedding(
        window.indexes.embedding,
        episode.indexes.embedding,
      ),
      0,
      1,
    );
  } catch {
    /*
     * Mismatched embedding dimensions cannot be compared.
     * The remaining signals still contribute to the score.
     */
    return 0;
  }
}

/**
 * Share of Window keywords that also exist in the Episode.
 */
function calculateKeywordOverlap(
  window: MemoryWindow,
  episode: MemoryEpisode,
): number {
  const windowKeywords = uniqueStrings(
    window.indexes.keywords,
  );

  if (windowKeywords.length === 0) {
    return 0;
  }

  const episodeKeywords = new Set(
    uniqueStrings(
      episode.indexes.keywords,
    ).map((keyword) =>
      normalizeText(keyword),
    ),
  );

  const matchedKeywords = windowKeywords.filter(
    (keyword) =>
      episodeKeywords.has(
        normalizeText(keyword),
      ),
  );

  return (
    matchedKeywords.length /
    windowKeywords.length
  );
}

/**
 * Share of Window entities that also exist in the Episode.
 *
 * Entities are compared with the normalized entity identity.
 */
function calculateEntityOverlap(
  window: MemoryWindow,
  episode: MemoryEpisode,
): number {
  const windowEntities = window.turns.flatMap(
    (turn) => turn.indexes.entities ?? [],
  );

  const windowKeys = new Set<string>();

  for (const entity of windowEntities) {
    if (
      !entity ||
      typeof entity.text !== "string" ||
      !entity.text.trim()
    ) {
      continue;
    }

    const normalized =
      typeof entity.normalized === "string" &&
      entity.normalized.trim()
        ? normalizeText(entity.normalized)
        : normalizeText(entity.text);

    if (normalized) {
      windowKeys.add(
        [normalized, entity.type].join(":"),
      );
    }
  }

  if (windowKeys.size === 0) {
    return 0;
  }

  const episodeKeys = new Set<string>();

  for (const entity of episode.indexes.entities) {
    episodeKeys.add(
      [
        normalizeText(entity.normalized),
        entity.type,
      ].join(":"),
    );
  }

  let matchedEntities = 0;

  for (const entityKey of windowKeys) {
    if (episodeKeys.has(entityKey)) {
      matchedEntities += 1;
    }
  }

  return matchedEntities / windowKeys.size;
}

/**
 * Scores one candidate Episode for the given Window.
 *
 * The combined score is a weighted average of embedding similarity,
 * keyword overlap, and entity overlap. The weights are normalized so
 * the score stays between 0 and 1 for every valid configuration.
 */
export function scoreEpisodeCandidate(
  window: MemoryWindow,
  episode: MemoryEpisode,
  config: EpisodeManagerConfig,
): EpisodeCandidateScore {
  const embeddingSimilarity =
    calculateEmbeddingSimilarity(
      window,
      episode,
    );

  const keywordOverlap =
    calculateKeywordOverlap(
      window,
      episode,
    );

  const entityOverlap =
    calculateEntityOverlap(
      window,
      episode,
    );

  const totalWeight =
    config.embeddingWeight +
    config.keywordWeight +
    config.entityWeight;

  const score =
    (config.embeddingWeight *
      embeddingSimilarity +
      config.keywordWeight *
        keywordOverlap +
      config.entityWeight *
        entityOverlap) /
    totalWeight;

  return {
    episode,
    score,
    embeddingSimilarity,
    keywordOverlap,
    entityOverlap,
  };
}

/* -------------------------------------------------------------------------- */
/* Candidate Selection                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Finds the best candidate Episode for the Window.
 *
 * The candidate list must already be filtered by the caller:
 * - only Episodes of the same session are passed in;
 * - only open Episodes are passed in.
 *
 * A Window is only appended when the combined score reaches the
 * configured threshold. The most recent Episode is never selected
 * without a sufficient score.
 */
export function findBestEpisodeCandidate(
  window: MemoryWindow,
  candidates: MemoryEpisode[],
  config: EpisodeManagerConfig,
): EpisodeCandidateScore | null {
  let bestCandidate: EpisodeCandidateScore | null =
    null;

  for (const candidate of candidates) {
    const scoredCandidate =
      scoreEpisodeCandidate(
        window,
        candidate,
        config,
      );

    if (
      scoredCandidate.score >=
        config.similarityThreshold &&
      (bestCandidate === null ||
        scoredCandidate.score >
          bestCandidate.score)
    ) {
      bestCandidate = scoredCandidate;
    }
  }

  return bestCandidate;
}
