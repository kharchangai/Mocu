import { readSettings } from "../../../../store";
import { combineAbortSignals } from "../../agent/abort";

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

const DEFAULT_DECISION_ENDPOINT_URL =
  "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_DECISION_MODEL = "~typesafe/jev-latest";

const DEFAULT_OPENROUTER_DECISION_HOSTS = new Set([
  "openrouter.ai",
  "api.openrouter.ai",
]);

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
  /** Optional API key override; defaults to the configured Decision API key. */
  apiKey?: string;
  /** Optional complete endpoint URL override; defaults to settings. */
  endpointUrl?: string;
  /** Optional override; defaults to the decision model from settings. */
  model?: string;
  timeoutMs?: number;
  /** Cancels the API call when the chat run is stopped. */
  signal?: AbortSignal;
};

export async function getJevDecision({
  state,
  questions,
  apiKey,
  endpointUrl,
  model,
  timeoutMs = 30_000,
  signal,
}: JevDecisionParams) {
  const settings = await readSettings();
  const sharedKeyHost = (() => {
    try {
      return new URL(settings.expensiveBaseUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  const sharedOpenRouterKey = DEFAULT_OPENROUTER_DECISION_HOSTS.has(sharedKeyHost)
    ? settings.apiKey
    : "";
  const resolvedApiKey =
    apiKey?.trim() || settings.decisionApiKey || sharedOpenRouterKey;

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

  const resolvedEndpointUrl =
    endpointUrl?.trim() ||
    settings.decisionEndpointUrl ||
    DEFAULT_DECISION_ENDPOINT_URL;
  const resolvedModel = model?.trim() || settings.decisionModel;

  const response = await fetch(resolvedEndpointUrl, {
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
    // Cancel with the caller's signal (chat stop button) or the timeout.
    signal: combineAbortSignals([AbortSignal.timeout(timeoutMs), signal]),
  });

  if (!response.ok) {
    // Avoid logging response bodies that may contain sensitive input.
    throw new Error(
      `OpenRouter Decisions API failed: HTTP ${response.status}`,
    );
  }

  return response.json();
}
