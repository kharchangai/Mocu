/**
 * Configuration contract for the hybrid docs retrieval pipeline.
 *
 * Pure module: no imports, so both `src/store.ts` (persistence) and
 * `src/chat/docs/doc-search.ts` (search-time validation) can depend on it
 * without creating an import cycle.
 *
 * All values are validated here with one documented rule set:
 *   - weights / relevance threshold: finite numbers clamped to [0, 1];
 *     anything non-finite (undefined, null, NaN, string) falls back.
 *   - result cap / candidate depth: finite numbers floored and clamped to
 *     their allowed range; anything non-finite falls back.
 *   - a weight set whose sum is 0 is invalid (nothing to rank by) and is
 *     replaced wholesale by the defaults.
 */

/** Per-signal relative weights. They do not need to sum to 1. */
export type DocsRetrievalWeights = {
  bm25: number;
  keyword: number;
  embedding: number;
};

export type DocsRetrievalConfig = {
  weights: DocsRetrievalWeights;
  /** Combined-score threshold in [0,1]; applied independently of the cap. */
  relevanceThreshold: number;
  /** Absolute maximum number of results any caller may receive. */
  resultCap: number;
  /** How many candidates each lexical SQL query may retrieve. */
  candidateDepth: number;
  /**
   * Jev relevance refinement stage. `enabled=false` keeps the deterministic
   * hybrid score only. When enabled, ONE bounded Jev call evaluates the top
   * `jevCandidateLimit` candidates after hybrid ranking; its probabilities
   * gate and refine each candidate's final score (see docs-jev.ts).
   */
  jev: {
    enabled: boolean;
    /** Maximum candidates sent to Jev in a single search (0 disables). */
    candidateLimit: number;
    /** Per-call Jev timeout in ms (explicit, short). */
    timeoutMs: number;
    /**
     * When a valid Jev probability is present:
     *   finalScore = (1 - jevWeight) * hybridScore + jevWeight * probability.
     */
    weight: number;
  };
};

/** The settings-backed fields (all optional so partial stores work). */
export type DocsRetrievalSettingsLike = {
  docsBm25Weight?: number | null;
  docsKeywordWeight?: number | null;
  docsEmbeddingWeight?: number | null;
  docsRelevanceThreshold?: number | null;
  docsResultCap?: number | null;
  docsCandidateDepth?: number | null;
  docsJevEnabled?: boolean | null;
  docsJevCandidateLimit?: number | null;
  docsJevTimeoutMs?: number | null;
  docsJevWeight?: number | null;
};

/** Per-call overrides (used by callers and tests; validated identically). */
export type SearchDocsOptions = {
  /**
   * Caller-requested result count. The configured result cap still applies
   * as an absolute ceiling: effective cap = min(limit, docsResultCap).
   */
  limit?: number;
  weights?: Partial<DocsRetrievalWeights>;
  relevanceThreshold?: number;
  candidateDepth?: number;
  /** Overrides the Jev enable flag for one call. */
  jevEnabled?: boolean;
  /** Overrides the Jev candidate limit for one call (clamped to its range). */
  jevCandidateLimit?: number;
};

export const DOCS_RETRIEVAL_DEFAULTS: DocsRetrievalConfig = {
  weights: { bm25: 0.5, keyword: 0.2, embedding: 0.3 },
  relevanceThreshold: 0.2,
  resultCap: 5,
  candidateDepth: 40,
  // Jev refinement off by default: search stays fully deterministic until
  // the user opts in (Jev also requires a configured Decision API key).
  jev: {
    enabled: false,
    candidateLimit: 8,
    timeoutMs: 3000,
    weight: 0.5,
  },
};

/** Allowed ranges (inclusive) for the integer settings. */
export const DOCS_RESULT_CAP_RANGE = { min: 1, max: 50 } as const;
export const DOCS_CANDIDATE_DEPTH_RANGE = { min: 1, max: 200 } as const;
export const DOCS_JEV_CANDIDATE_LIMIT_RANGE = { min: 1, max: 20 } as const;
export const DOCS_JEV_TIMEOUT_RANGE = { min: 500, max: 30_000 } as const;

/** Validates a [0,1] number (weights, threshold). Non-finite → fallback. */
export function validateUnitInterval(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

/** Validates an integer inside [min,max]. Non-finite → fallback. */
export function validateRangedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const floored = Math.floor(value);
  if (floored < min || floored > max) {
    // Clamp in-range-ness rather than rejecting user input wholesale;
    // a persisted 0 cap would silently disable search.
    return Math.min(max, Math.max(min, floored));
  }
  return floored;
}

/**
 * Builds the effective retrieval config from persisted settings plus
 * optional per-call overrides. Both go through the same validation.
 *
 * Documented behaviors:
 *   - invalid/missing values fall back to `DOCS_RETRIEVAL_DEFAULTS`
 *     (per field, except weights — see next point)
 *   - if the three weights sum to 0, ALL weights fall back to defaults
 *   - overrides win over settings, but only after validating the same way
 */
export function resolveDocsRetrievalConfig(
  settings: DocsRetrievalSettingsLike | null | undefined,
  overrides: SearchDocsOptions = {},
): DocsRetrievalConfig {
  const defaults = DOCS_RETRIEVAL_DEFAULTS;

  let bm25 = validateUnitInterval(settings?.docsBm25Weight, defaults.weights.bm25);
  let keyword = validateUnitInterval(
    settings?.docsKeywordWeight,
    defaults.weights.keyword,
  );
  let embedding = validateUnitInterval(
    settings?.docsEmbeddingWeight,
    defaults.weights.embedding,
  );

  if (overrides.weights) {
    if (overrides.weights.bm25 !== undefined) {
      bm25 = validateUnitInterval(overrides.weights.bm25, bm25);
    }
    if (overrides.weights.keyword !== undefined) {
      keyword = validateUnitInterval(overrides.weights.keyword, keyword);
    }
    if (overrides.weights.embedding !== undefined) {
      embedding = validateUnitInterval(overrides.weights.embedding, embedding);
    }
  }

  if (bm25 + keyword + embedding <= 0) {
    bm25 = defaults.weights.bm25;
    keyword = defaults.weights.keyword;
    embedding = defaults.weights.embedding;
  }

  let relevanceThreshold = validateUnitInterval(
    settings?.docsRelevanceThreshold,
    defaults.relevanceThreshold,
  );
  if (overrides.relevanceThreshold !== undefined) {
    relevanceThreshold = validateUnitInterval(
      overrides.relevanceThreshold,
      relevanceThreshold,
    );
  }

  const resultCap = validateRangedInt(
    settings?.docsResultCap,
    defaults.resultCap,
    DOCS_RESULT_CAP_RANGE.min,
    DOCS_RESULT_CAP_RANGE.max,
  );

  let candidateDepth = validateRangedInt(
    settings?.docsCandidateDepth,
    defaults.candidateDepth,
    DOCS_CANDIDATE_DEPTH_RANGE.min,
    DOCS_CANDIDATE_DEPTH_RANGE.max,
  );
  if (overrides.candidateDepth !== undefined) {
    candidateDepth = validateRangedInt(
      overrides.candidateDepth,
      candidateDepth,
      DOCS_CANDIDATE_DEPTH_RANGE.min,
      DOCS_CANDIDATE_DEPTH_RANGE.max,
    );
  }

  return {
    weights: { bm25, keyword, embedding },
    relevanceThreshold,
    resultCap,
    candidateDepth,
    jev: resolveJevSettings(settings, overrides),
  };
}

/**
 * Jev refinement settings, validated exactly like the other retrieval
 * fields:
 *   - `enabled`: explicit boolean only; anything else falls back to the
 *     default (false).
 *   - `candidateLimit`: integer clamped to DOCS_JEV_CANDIDATE_LIMIT_RANGE
 *     (0 is clamped to 1 — use the enable flag to turn Jev off).
 *   - `timeoutMs`: integer clamped to DOCS_JEV_TIMEOUT_RANGE.
 *   - `weight`: [0,1]. A weight of 0 makes the final score purely hybrid.
 */
function resolveJevSettings(
  settings: DocsRetrievalSettingsLike | null | undefined,
  overrides: SearchDocsOptions,
): DocsRetrievalConfig["jev"] {
  const defaults = DOCS_RETRIEVAL_DEFAULTS.jev;

  let enabled =
    typeof settings?.docsJevEnabled === "boolean"
      ? settings.docsJevEnabled
      : defaults.enabled;
  if (overrides.jevEnabled !== undefined) {
    enabled = typeof overrides.jevEnabled === "boolean" ? overrides.jevEnabled : enabled;
  }

  let candidateLimit = validateRangedInt(
    settings?.docsJevCandidateLimit,
    defaults.candidateLimit,
    DOCS_JEV_CANDIDATE_LIMIT_RANGE.min,
    DOCS_JEV_CANDIDATE_LIMIT_RANGE.max,
  );
  if (overrides.jevCandidateLimit !== undefined) {
    candidateLimit = validateRangedInt(
      overrides.jevCandidateLimit,
      candidateLimit,
      DOCS_JEV_CANDIDATE_LIMIT_RANGE.min,
      DOCS_JEV_CANDIDATE_LIMIT_RANGE.max,
    );
  }

  const timeoutMs = validateRangedInt(
    settings?.docsJevTimeoutMs,
    defaults.timeoutMs,
    DOCS_JEV_TIMEOUT_RANGE.min,
    DOCS_JEV_TIMEOUT_RANGE.max,
  );

  const weight = validateUnitInterval(settings?.docsJevWeight, defaults.weight);

  return { enabled, candidateLimit, timeoutMs, weight };
}

/**
 * Final result cap for one call: the caller may ask for fewer results than
 * the configured cap, never for more. Invalid/missing limits fall back to
 * the configured cap.
 */
export function resolveEffectiveCap(
  config: DocsRetrievalConfig,
  requestedLimit: unknown,
): number {
  const requested = validateRangedInt(
    requestedLimit,
    config.resultCap,
    DOCS_RESULT_CAP_RANGE.min,
    DOCS_RESULT_CAP_RANGE.max,
  );
  return Math.min(config.resultCap, requested);
}
