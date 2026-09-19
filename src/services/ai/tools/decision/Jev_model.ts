import { readSettings } from "../../../../store";

/**
 * Jev Decision Model.
 *
 * Calls the OpenRouter Decisions API (~typesafe/jev-latest). This model does
 * not generate text; it answers typed questions about a state and returns
 * calibrated probabilities:
 *  - "noul":  a yes/no probability
 *  - "choice": a pick from caller-defined options
 *  - "score": a position on an ordered rubric
 *
 * Configuration (API key, base URL, model) is read from app settings first,
 * with an OPENROUTER_API_KEY environment variable fallback.
 */

const DEFAULT_DECISION_BASE_URL = "https://openrouter.ai/api";
const DEFAULT_DECISION_MODEL = "~typesafe/jev-latest";

export type JevDecisionQuestion = {
  type: "noul" | "choice" | "score";
  instructions?: string;
  criteria:
    | { true: string; false: string } // noul
    | Record<string, string> // choice
    | string[]; // score
};

export type JevDecisionQuestions = Record<string, JevDecisionQuestion>;

export type JevDecisionParams = {
  /** The state (string, object, or array) to answer questions about. */
  state: unknown;
  /** Typed questions keyed by a caller-chosen name. */
  questions: JevDecisionQuestions;
  /** Optional override; defaults to settings, then OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Optional override; defaults to the decision base URL from settings. */
  baseUrl?: string;
  /** Optional override; defaults to the decision model from settings. */
  model?: string;
  timeoutMs?: number;
};

function buildDecisionUrl(baseUrl: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, "");

  if (!cleanBase) {
    return `${DEFAULT_DECISION_BASE_URL}/alpha/decisions`;
  }

  // Accept either the API root ("https://openrouter.ai/api") or a full
  // endpoint ("https://openrouter.ai/api/alpha/decisions").
  if (/\/alpha\/decisions$/.test(cleanBase)) {
    return cleanBase;
  }

  return `${cleanBase}/alpha/decisions`;
}

export async function getJevDecision({
  state,
  questions,
  apiKey,
  baseUrl,
  model,
  timeoutMs = 30_000,
}: JevDecisionParams) {
  const settings = await readSettings();

  const resolvedApiKey = apiKey?.trim() || settings.decisionApiKey;

  if (!resolvedApiKey) {
    throw new Error(
      "Decision API key is not configured. Open Settings and set the Decision (Jev) API key.",
    );
  }

  if (state === undefined) {
    throw new Error("state is required.");
  }

  if (
    !questions ||
    typeof questions !== "object" ||
    Array.isArray(questions) ||
    Object.keys(questions).length === 0
  ) {
    throw new Error("questions must be a non-empty object.");
  }

  const resolvedBaseUrl = baseUrl?.trim() || settings.decisionBaseUrl;
  const resolvedModel = model?.trim() || settings.decisionModel;

  const response = await fetch(buildDecisionUrl(resolvedBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resolvedApiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel || DEFAULT_DECISION_MODEL,
      state,
      questions,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // Avoid logging response bodies that may contain sensitive input.
    throw new Error(
      `OpenRouter Decisions API failed: HTTP ${response.status}`,
    );
  }

  return response.json();
}
