// window/types.ts

/**
 * All public types of the Window layer.
 */

export interface WindowEntity {
  text: string;
  normalized: string;
  type: string;
}

export interface TurnIndexes {
  subject: string;
  keywords: string[];

  /**
   * Entities extracted from the Turn. Optional so that older Turns
   * without entities remain valid.
   */
  entities?: WindowEntity[];

  type: string;
  embedding: number[];
}

export interface Turn {
  userMessage: string;
  agentResponse: string;
  indexes: TurnIndexes;
  createdAt: string;
  estimatedTokens: number;
}

export type WindowStatus = "open" | "closed";

export type WindowBoundaryReason =
  | "llm_boundary"
  | "maximum_turns"
  | "maximum_tokens"
  | "oversized_turn"
  | "manual";

export interface WindowIndexes {
  /**
   * Always exactly one entry: the single comprehensive main subject
   * created by the LLM from the subjects of ALL Turns in the Window.
   * It is regenerated every time a new Turn is added, so it always
   * reflects the combined meaning of every Turn.
   */
  subjects: string[];

  /**
   * Unique union of all Turn keywords in the Window.
   */
  keywords: string[];

  /**
   * Unique union of all Turn types in the Window.
   */
  types: string[];

  /**
   * Semantic embedding of the combination of all Window subjects and
   * keywords, created with the embedding model.
   */
  embedding: number[];
}

export interface MemoryWindow {
  /**
   * Stable identifier. It is also used as the database record key.
   */
  id: string;

  /**
   * Original Turns are preserved without rewriting or summarization.
   */
  turns: Turn[];

  indexes: WindowIndexes;
  status: WindowStatus;
  estimatedTokens: number;
  startedAt: string;
  updatedAt: string;
  closedAt?: string;
  boundaryReason?: WindowBoundaryReason;

  /**
   * Optional session membership. Existing stored Windows do not have
   * this field and are treated as belonging to the default session.
   */
  sessionId?: string;

  /**
   * Set by the EpisodeManager when the Window is assigned to an
   * Episode. It is the inverse side of Episode.windowIds.
   */
  episodeId?: string;
}

export interface BoundaryDecision {
  decision: "continue" | "boundary";
  confidence: number;
  reason: string;
  similarity: number;
}

/**
 * Stable output passed from WindowManager to EpisodeManager.
 *
 * Only closed Windows should be passed to EpisodeManager because an open
 * Window can still receive additional Turns and change its indexes.
 */
export interface EpisodeWindowInput {
  window: MemoryWindow;
  boundaryReason: WindowBoundaryReason;
  readyAt: string;
}

export interface AddTurnToWindowResult {
  action: "created" | "appended";

  /**
   * Database key of the Window that now contains the Turn.
   */
  windowId: string;

  window: MemoryWindow;
  closedWindow?: MemoryWindow;
  episodeInput?: EpisodeWindowInput;
  boundaryDecision?: BoundaryDecision;
}

export interface CloseOpenWindowResult {
  windowId: string;
  closedWindow: MemoryWindow;
  episodeInput: EpisodeWindowInput;
}

export interface WindowManagerConfig {
  maximumTurns: number;
  maximumTokens: number;

  /**
   * Used when the LLM request fails or returns invalid data.
   */
  fallbackSimilarityThreshold: number;

  /**
   * Number of recent Turns sent to the LLM.
   */
  recentTurnsForBoundary: number;
}
