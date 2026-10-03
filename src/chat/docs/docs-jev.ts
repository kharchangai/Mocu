/**
 * Bounded Jev relevance evaluation for the hybrid docs search pipeline.
 *
 * Design contract (documented here as the single source of truth):
 *
 *   - ONE call per search: the top `jev.candidateLimit` candidates after
 *     hybrid ranking are evaluated in a single `getJevDecision` choice
 *     question. Jev is NEVER called once per document or once per section
 *     anywhere in the search pipeline.
 *   - Compact input: Jev receives the trimmed query plus, per candidate,
 *     only `id`, `title` and `description` — each field truncated
 *     (`MAX_TITLE_CHARS` / `MAX_DESCRIPTION_CHARS`) and the overall payload
 *     bounded by `MAX_STATE_CHARS`. Bodies/keywords are never sent.
 *   - Explicit short timeout: every call passes `timeoutMs` (validated to
 *     DOCS_JEV_TIMEOUT_RANGE) and a fresh `AbortController` signal, so both
 *     the timeout and an external cancellation stop the request.
 *   - Valid results only: a probability is accepted only when it is a finite
 *     number inside [0,1]. Malformed entries are dropped per candidate and
 *     the whole call degrades to the deterministic fallback when nothing
 *     usable comes back.
 *   - Probabilities GATE and REFINE the hybrid score — they do not replace
 *     it: `final = clamp01((1 - weight) * hybrid + weight * probability)`.
 *     Both the original hybrid score and the final score are retained on
 *     every result (DocSearchResult.score / .jev.hybridScore).
 *   - Deterministic failure policy: Jev disabled, no Decision API key,
 *     timeout, abort, HTTP error, malformed/empty response → every candidate
 *     keeps `probability = null` and `final = hybrid`. The relevance
 *     threshold still applies to the (unchanged) hybrid score, so no
 *     below-threshold result is ever promoted by a failed Jev call.
 *
 * Signature compatibility: `getJevDecision` accepts `{ state, questions,
 * timeoutMs?, signal? }` and resolves the API key/base URL/model from app
 * settings; it throws when no Decision API key is configured. This module
 * converts every failure path into the documented fallback instead of
 * propagating.
 */

import { getJevDecision } from "../../services/ai/tools/decision/Jev_model";
import type { DocsRetrievalConfig } from "./docs-retrieval-config";

/** Hard cap on candidates sent to Jev in one search (defense in depth; the
 *  configured candidateLimit is clamped to DOCS_JEV_CANDIDATE_LIMIT_RANGE). */
export const MAX_JEV_CANDIDATES = 20;
/** Total serialized state budget sent to Jev (characters). */
export const MAX_STATE_CHARS = 4000;
/** Per-field truncation limits for the compact Jev input. */
export const MAX_QUERY_CHARS = 400;
export const MAX_ID_CHARS = 120;
export const MAX_TITLE_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 240;
/** Jev choice-option key/label length. */
export const MAX_OPTION_KEY_CHARS = 160;

/** The decision API key setting read once per evaluation (cheap store read). */
type JevSettingsLike = { decisionApiKey?: string | null };

/** Compact per-candidate projection — only these fields ever reach Jev. */
export type JevCandidateSummary = {
  id: string;
  title: string;
  description: string;
};

/** Failure reasons surfaced on an evaluation (null = n/a; "jev" = applied). */
export type JevEvaluationSource =
  | "jev"
  | "disabled"
  | "no-key"
  | "timeout"
  | "cancelled"
  | "error"
  | "malformed"
  | "out-of-range"
  | "not-evaluated"
  | "weight-zero"
  | null;

export type JevCandidateEvaluation = {
  /** Jev relevance probability in [0,1]; null when unavailable/invalid. */
  probability: number | null;
  /** The deterministic hybrid score this candidate had before Jev. */
  hybridScore: number;
  /** Final score after (optional) Jev refinement; equals hybridScore when
   *  probability is null. Always in [0,1]. */
  finalScore: number;
  /**
   * Why (or whether) a probability was produced:
   *   - "jev": a valid probability was applied (gate + refine)
   *   - "disabled": Jev stage off (or no candidates)
   *   - "no-key": no Decision API key configured / settings unreadable
   *   - "timeout" / "cancelled": the call was aborted
   *   - "error": HTTP/network failure or thrown rejection
   *   - "malformed": response parsed but no usable probability
   *   - "out-of-range": probability present but not in [0,1]
   *   - "weight-zero": configured jev weight is 0 (final = hybrid anyway)
   */
  source: JevEvaluationSource;
};

export type EvaluateDocsJevOptions = {
  /** The user query (compactly included in the Jev state). */
  query: string;
  /** The bounded, hybrid-ranked candidate slice (order = rank order). */
  candidates: readonly JevCandidateSummary[];
  /** The deterministic hybrid score per candidate id. */
  hybridScores: ReadonlyMap<string, number>;
  /** Retrieval config (uses config.jev only). */
  config: DocsRetrievalConfig;
  /** Cancellation from the caller (e.g. chat run stop button). */
  signal?: AbortSignal;
  /**
   * Test hook: skip the "is a Decision API key configured?" settings read
   * and go straight to the call (a mocked getJevDecision may then throw its
   * own missing-key error, which follows the same "no-key" path).
   */
  skipKeyCheck?: boolean;
};

/**
 * Truncates to `max` characters, appending "…" when cut (never splits a
 * lone high surrogate at the cut point).
 */
export function truncateForJev(text: string, max: number): string {
  const value = typeof text === "string" ? text : "";
  if (value.length <= max) {
    return value;
  }
  const sliced = value.slice(0, Math.max(0, max - 1));
  const last = sliced.charCodeAt(sliced.length - 1);
  const clean =
    last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
  return `${clean}…`;
}

/**
 * Serializes the compact state handed to Jev, respecting MAX_STATE_CHARS.
 * Exposed for tests/diagnostics.
 */
export function buildJevState(
  query: string,
  candidates: readonly JevCandidateSummary[],
): string {
  let budget = MAX_STATE_CHARS;
  const parts: string[] = [];

  const queryPart = `Query: ${truncateForJev(query.trim(), MAX_QUERY_CHARS)}`;
  parts.push(queryPart);
  budget -= queryPart.length;

  for (const candidate of candidates) {
    const id = truncateForJev(candidate.id, MAX_ID_CHARS);
    const title = truncateForJev(candidate.title, MAX_TITLE_CHARS);
    const description = truncateForJev(
      candidate.description,
      MAX_DESCRIPTION_CHARS,
    );
    const line = `- id=${id} | title=${title} | description=${description}`;
    if (line.length + 1 > budget) {
      break;
    }
    parts.push(line);
    budget -= line.length + 1;
  }

  return parts.join("\n");
}

type UnitProbability = { ok: true; value: number } | { ok: false };

function toUnitProbability(raw: unknown): UnitProbability | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : Number.NaN;
  if (!Number.isFinite(value)) {
    return null; // non-numeric junk counts as "absent"
  }
  return value >= 0 && value <= 1
    ? { ok: true, value }
    : { ok: false };
}

/**
 * Extracts a valid probability structure from one Jev answer, or the reason
 * none exists. Recognized shapes (in order):
 *   1. `noul` — an explicit yes/relevant probability for the whole set.
 *   2. `probabilities` — a distribution over the choice options (per-key
 *      mapping happens in the caller).
 *   3. `choice`/`value`/`answer`/`selected` — a single chosen option; the
 *      caller maps it to probability 1 for the chosen id and 0 for the rest.
 * Anything else is "malformed"; values outside [0,1] are "out-of-range".
 */
export function extractJevAnswer(
  answer: unknown,
):
  | { kind: "probabilities"; values: Record<string, number> }
  | { kind: "noul"; probability: number }
  | { kind: "choice"; key: string }
  | { kind: "invalid"; source: "malformed" | "out-of-range" } {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return { kind: "invalid", source: "malformed" };
  }

  const record = answer as Record<string, unknown>;

  // 1) Explicit noul probability (shape used by other Jev consumers).
  const noul = toUnitProbability(record.noul);
  if (noul !== null) {
    return noul.ok
      ? { kind: "noul", probability: noul.value }
      : { kind: "invalid", source: "out-of-range" };
  }

  // 2) Probability distribution over the choice options.
  const probabilities = record.probabilities;
  if (
    probabilities &&
    typeof probabilities === "object" &&
    !Array.isArray(probabilities)
  ) {
    const values: Record<string, number> = {};
    let sawValue = false;
    let outOfRange = false;
    for (const [key, raw] of Object.entries(
      probabilities as Record<string, unknown>,
    )) {
      const parsed = toUnitProbability(raw);
      if (parsed === null) {
        continue;
      }
      sawValue = true;
      if (!parsed.ok) {
        outOfRange = true;
        continue;
      }
      values[key] = parsed.value;
    }
    if (Object.keys(values).length > 0) {
      return { kind: "probabilities", values };
    }
    if (outOfRange) {
      return { kind: "invalid", source: "out-of-range" };
    }
    if (sawValue) {
      return { kind: "invalid", source: "malformed" };
    }
  }

  // 3) Single chosen option.
  const chosen = [record.choice, record.value, record.answer, record.selected];
  for (const candidate of chosen) {
    if (typeof candidate === "string" && candidate.trim()) {
      return { kind: "choice", key: candidate.trim() };
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return { kind: "choice", key: String(candidate) };
    }
  }

  return { kind: "invalid", source: "malformed" };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Applies the documented gate+refine formula:
 * `final = clamp01((1 - w) * hybrid + w * probability)`.
 */
export function refineHybridScore(
  hybrid: number,
  probability: number,
  weight: number,
): number {
  const w = clamp01(weight);
  return clamp01((1 - w) * clamp01(hybrid) + w * clamp01(probability));
}

/** The neutral result: every candidate keeps its hybrid score. */
function fallbackResults(
  candidates: readonly JevCandidateSummary[],
  hybridScores: ReadonlyMap<string, number>,
  source: Exclude<JevEvaluationSource, "jev" | null>,
): Map<string, JevCandidateEvaluation> {
  const results = new Map<string, JevCandidateEvaluation>();
  for (const candidate of candidates) {
    const hybridScore = clamp01(hybridScores.get(candidate.id) ?? 0);
    results.set(candidate.id, {
      probability: null,
      hybridScore,
      finalScore: hybridScore,
      source,
    });
  }
  return results;
}

function classifyAbort(error: unknown): "cancelled" | "timeout" | null {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  const isAbort = name === "AbortError" || name === "TimeoutError";
  if (!isAbort) {
    return null;
  }
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (
    name === "TimeoutError" ||
    message.toLowerCase().includes("timeout") ||
    message.toLowerCase().includes("timed out")
  ) {
    return "timeout";
  }
  return "cancelled";
}

/**
 * Evaluates the bounded candidate slice with ONE Jev call and returns a
 * per-candidate evaluation keyed by id. Never throws: every failure mode
 * degrades to the deterministic hybrid-score fallback documented above.
 */
export async function evaluateDocsJevRelevance(
  options: EvaluateDocsJevOptions,
): Promise<Map<string, JevCandidateEvaluation>> {
  const { candidates, hybridScores, config, signal } = options;
  const jevConfig = config.jev;

  if (!jevConfig.enabled || candidates.length === 0) {
    return fallbackResults(candidates, hybridScores, "disabled");
  }

  // Bounded candidate set: never more than the configured limit (already
  // clamped to [1,20] by config validation, plus this hard cap).
  const bounded = candidates.slice(
    0,
    Math.min(jevConfig.candidateLimit, MAX_JEV_CANDIDATES),
  );

  if (jevConfig.weight <= 0) {
    // Weight 0 → final score is the hybrid score regardless of Jev; skip
    // the network call entirely (explicit, documented outcome).
    return fallbackResults(bounded, hybridScores, "weight-zero");
  }

  if (!options.skipKeyCheck) {
    try {
      const { readSettings } = await import("../../store");
      const settings = (await readSettings()) as JevSettingsLike;
      if (!(settings?.decisionApiKey ?? "").trim()) {
        return fallbackResults(bounded, hybridScores, "no-key");
      }
    } catch {
      // Settings unreadable → treat as a missing key (deterministic fallback).
      return fallbackResults(bounded, hybridScores, "no-key");
    }
  }

  // Compact choice question: option key = "<n>", label = "<n>. <title>".
  // One call covers every candidate — never one call per document/section.
  const criteria: Record<string, string> = {};
  const idByKey = new Map<string, string>();
  const labelByKey = new Map<string, string>();
  bounded.forEach((candidate, index) => {
    const key = String(index + 1);
    const label = truncateForJev(
      `${key}. ${candidate.title}`,
      MAX_OPTION_KEY_CHARS,
    );
    criteria[key] = label;
    idByKey.set(key, candidate.id);
    labelByKey.set(key, label);
  });

  // Timeout + external cancellation: a fresh controller so aborting our
  // signal stops this call and nothing else.
  const abort = new AbortController();
  const onExternalAbort = () => abort.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      return fallbackResults(bounded, hybridScores, "cancelled");
    }
    signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const response = (await getJevDecision({
      state: buildJevState(options.query, bounded),
      questions: {
        doc_relevance: {
          type: "choice",
          instructions:
            "The user query is stated first, followed by candidate documents " +
            "(id, title, description only). For EVERY option give the " +
            "probability that the document is relevant to the query, using " +
            "the 'probabilities' field. Every probability must be between " +
            "0 and 1.",
          criteria,
        },
      },
      // Explicit short timeout (validated to DOCS_JEV_TIMEOUT_RANGE).
      timeoutMs: jevConfig.timeoutMs,
      signal: abort.signal,
    })) as unknown;

    return mapResponseToEvaluations(
      response,
      bounded,
      hybridScores,
      idByKey,
      labelByKey,
      jevConfig.weight,
    );
  } catch (error) {
    const abortKind = classifyAbort(error);
    if (abortKind) {
      return fallbackResults(bounded, hybridScores, abortKind);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("API key is not configured")) {
      return fallbackResults(bounded, hybridScores, "no-key");
    }
    return fallbackResults(bounded, hybridScores, "error");
  } finally {
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Maps a raw Jev response onto per-candidate evaluations. Keys of the
 * response that do not match a bounded option are ignored (the candidate
 * set is never expanded by the response).
 */
function mapResponseToEvaluations(
  response: unknown,
  bounded: readonly JevCandidateSummary[],
  hybridScores: ReadonlyMap<string, number>,
  idByKey: ReadonlyMap<string, string>,
  labelByKey: ReadonlyMap<string, string>,
  weight: number,
): Map<string, JevCandidateEvaluation> {
  const answers =
    response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>).answers
      : undefined;

  const answer =
    answers && typeof answers === "object" && !Array.isArray(answers)
      ? (answers as Record<string, unknown>).doc_relevance
      : undefined;

  if (!answer) {
    return fallbackResults(bounded, hybridScores, "malformed");
  }

  const parsed = extractJevAnswer(answer);

  let probabilityById: Map<string, number> | null = null;
  let failureSource: Exclude<JevEvaluationSource, "jev" | null> = "malformed";

  if (parsed.kind === "noul") {
    // A single relevance probability for the whole set applies uniformly.
    probabilityById = new Map(
      bounded.map((candidate) => [candidate.id, parsed.probability]),
    );
  } else if (parsed.kind === "probabilities") {
    probabilityById = new Map();
    for (const [key, value] of Object.entries(parsed.values)) {
      const id = idByKey.get(key);
      if (id !== undefined) {
        probabilityById.set(id, value);
      }
      // Keys outside the bounded slice are ignored (never expand the set).
    }
    if (probabilityById.size === 0) {
      probabilityById = null;
      failureSource = "malformed";
    }
  } else if (parsed.kind === "choice") {
    // Single chosen option → certainty for it, zero for the rest.
    probabilityById = new Map();
    const chosen = parsed.key;
    for (const [key, id] of idByKey) {
      const matches =
        chosen === key ||
        chosen === labelByKey.get(key) ||
        (chosen.length > key.length + 1 && chosen.startsWith(`${key}.`));
      probabilityById.set(id, matches ? 1 : 0);
    }
  } else {
    probabilityById = null;
    failureSource = parsed.source;
  }

  const results = new Map<string, JevCandidateEvaluation>();

  for (const candidate of bounded) {
    const hybridScore = clamp01(hybridScores.get(candidate.id) ?? 0);
    const probability = probabilityById?.get(candidate.id) ?? null;

    if (
      probability === null ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      results.set(candidate.id, {
        probability: null,
        hybridScore,
        finalScore: hybridScore,
        source: probability === null ? failureSource : "out-of-range",
      });
      continue;
    }

    results.set(candidate.id, {
      probability,
      hybridScore,
      finalScore: refineHybridScore(hybridScore, probability, weight),
      source: "jev",
    });
  }

  return results;
}