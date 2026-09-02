// episode/types.ts

/**
 * All public types of the Episode layer.
 *
 * The Episode layer performs for the Window exactly the same role that
 * the Window layer performs for the Turn.
 */

import type { WindowEntity } from "../window/types";

export type EpisodeStatus = "open" | "closed";

export interface EpisodeIndexes {
  /**
   * One general subject for all Window subjects, created by the LLM.
   * It must be broader than every individual Window subject.
   */
  subject: string;

  /**
   * Unique union of all member Window subjects in their original
   * order.
   */
  subjects: string[];

  /**
   * Unique union of all member Window keywords.
   */
  keywords: string[];

  /**
   * Unique union of all member Window types.
   */
  types: string[];

  /**
   * Unique union of the entities of all member Window Turns, merged
   * with the existing normalized entity identity.
   */
  entities: WindowEntity[];

  /**
   * Semantic embedding of the general subject, Window subjects,
   * keywords, types, and entities, created with the embedding model.
   */
  embedding: number[];
}

export interface MemoryEpisode {
  /**
   * Stable identifier. It is also used as the database record key.
   */
  id: string;

  /**
   * Session this Episode belongs to. Episodes are only matched inside
   * one session.
   */
  sessionId: string;

  /**
   * Ids of the member Windows in insertion order.
   *
   * A Window id can appear at most once. Windows keep their own
   * database records; no Window payload is duplicated here.
   */
  windowIds: string[];

  indexes: EpisodeIndexes;
  status: EpisodeStatus;
  estimatedTokens: number;
  startedAt: string;
  updatedAt: string;
  closedAt?: string;
}

/**
 * Session used by Windows that do not carry their own sessionId.
 *
 * The existing Window pipeline has no session concept yet, therefore
 * all existing Windows are grouped into this single session.
 */
export const DEFAULT_SESSION_ID = "default";

export type EpisodeAction =
  | "created"
  | "appended"
  | "updated";

export interface AssignWindowToEpisodeResult {
  episodeId: string;
  action: EpisodeAction;
  episode: MemoryEpisode;
}

export interface EpisodeManagerConfig {
  /**
   * Minimum combined score for a Window to be appended to an existing
   * Episode.
   *
   * This value is intentionally lower than the Window fallback
   * similarity threshold because an Episode groups several Windows and
   * must therefore match semantically broader than a Window.
   *
   * IMPORTANT: This threshold is a starting point and requires
   * empirical calibration with real conversation data.
   */
  similarityThreshold: number;

  /**
   * Weight of the embedding similarity in the combined score.
   */
  embeddingWeight: number;

  /**
   * Weight of the keyword overlap in the combined score.
   */
  keywordWeight: number;

  /**
   * Weight of the entity overlap in the combined score.
   */
  entityWeight: number;
}

/**
 * Compact Window representation that is sent to the LLM to create the
 * general Episode subject.
 *
 * Raw Turns are never sent to the LLM because Window indexes already
 * provide sufficient information.
 */
export interface EpisodeWindowSummary {
  subject: string;
  keywords: string[];
  types: string[];
  entities: string[];
}

export interface EpisodeCandidateScore {
  episode: MemoryEpisode;
  score: number;
  embeddingSimilarity: number;
  keywordOverlap: number;
  entityOverlap: number;
}
