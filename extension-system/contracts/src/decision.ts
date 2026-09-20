export const DECISION_ASK_METHOD = "mocu.decision.ask" as const;

/**
 * One typed question about a state, answered by Mocu's configured Jev
 * decision model (OpenRouter Decisions API). The model does not generate
 * text; it returns calibrated probabilities.
 */
export interface DecisionQuestion {
  type: "noul" | "choice" | "score";
  instructions?: string;
  criteria:
    | { true: string; false: string } // noul
    | Record<string, string> // choice
    | string[]; // score
}

export interface DecisionAskParams {
  /** The state (string, object, or array) to answer questions about. */
  state: unknown;
  /** Typed questions keyed by a caller-chosen name. */
  questions: Record<string, DecisionQuestion>;
}

/**
 * Raw result of the OpenRouter Decisions API, passed through verbatim.
 * Shape: one answer per question key with probabilities / choice / score.
 */
export type DecisionAskResult = unknown;
