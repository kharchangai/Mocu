import { describe, expect, it } from "vitest";

import {
  DOCS_RETRIEVAL_DEFAULTS,
  resolveDocsRetrievalConfig,
  resolveEffectiveCap,
  validateRangedInt,
  validateUnitInterval,
} from "./docs-retrieval-config";

describe("validateUnitInterval", () => {
  it("clamps finite numbers into [0,1]", () => {
    expect(validateUnitInterval(0.5, 0.9)).toBe(0.5);
    expect(validateUnitInterval(-3, 0.9)).toBe(0);
    expect(validateUnitInterval(42, 0.9)).toBe(1);
    expect(validateUnitInterval(0, 0.9)).toBe(0);
    expect(validateUnitInterval(1, 0.9)).toBe(1);
  });

  it("falls back for non-finite or non-number input", () => {
    expect(validateUnitInterval(undefined, 0.42)).toBe(0.42);
    expect(validateUnitInterval(null, 0.42)).toBe(0.42);
    expect(validateUnitInterval(Number.NaN, 0.42)).toBe(0.42);
    expect(validateUnitInterval("0.5", 0.42)).toBe(0.42);
    expect(validateUnitInterval(Infinity, 0.42)).toBe(0.42);
  });
});

describe("validateRangedInt", () => {
  it("floors and clamps into the allowed range", () => {
    expect(validateRangedInt(7, 5, 1, 50)).toBe(7);
    expect(validateRangedInt(7.9, 5, 1, 50)).toBe(7);
    expect(validateRangedInt(-10, 5, 1, 50)).toBe(1);
    expect(validateRangedInt(9999, 5, 1, 50)).toBe(50);
  });

  it("falls back for non-finite input", () => {
    expect(validateRangedInt(undefined, 5, 1, 50)).toBe(5);
    expect(validateRangedInt(Number.NaN, 5, 1, 50)).toBe(5);
    expect(validateRangedInt("12", 5, 1, 50)).toBe(5);
  });
});

describe("resolveDocsRetrievalConfig", () => {
  it("uses documented defaults when settings are missing", () => {
    expect(resolveDocsRetrievalConfig(null)).toEqual(DOCS_RETRIEVAL_DEFAULTS);
    expect(resolveDocsRetrievalConfig(undefined)).toEqual(
      DOCS_RETRIEVAL_DEFAULTS,
    );
    expect(resolveDocsRetrievalConfig({})).toEqual(DOCS_RETRIEVAL_DEFAULTS);
  });

  it("applies valid settings values", () => {
    const config = resolveDocsRetrievalConfig({
      docsBm25Weight: 0.7,
      docsKeywordWeight: 0.1,
      docsEmbeddingWeight: 0.2,
      docsRelevanceThreshold: 0.55,
      docsResultCap: 9,
      docsCandidateDepth: 33,
    });

    expect(config.weights).toEqual({ bm25: 0.7, keyword: 0.1, embedding: 0.2 });
    expect(config.relevanceThreshold).toBe(0.55);
    expect(config.resultCap).toBe(9);
    expect(config.candidateDepth).toBe(33);
  });

  it("falls back per field for invalid values", () => {
    const config = resolveDocsRetrievalConfig({
      docsBm25Weight: Number.NaN,
      docsKeywordWeight: -1,
      docsEmbeddingWeight: 4,
      docsRelevanceThreshold: Number.NaN,
      docsResultCap: 0,
      docsCandidateDepth: 10_000,
    });

    // weights: NaN falls back, negatives clamp to 0, >1 clamps to 1 —
    // the sum (0.5 + 0 + 1) is > 0 so defaults are NOT applied wholesale.
    expect(config.weights.bm25).toBe(DOCS_RETRIEVAL_DEFAULTS.weights.bm25);
    expect(config.weights.keyword).toBe(0);
    expect(config.weights.embedding).toBe(1);
    expect(config.relevanceThreshold).toBe(
      DOCS_RETRIEVAL_DEFAULTS.relevanceThreshold,
    );
    expect(config.resultCap).toBe(1); // clamped to the minimum, never 0
    expect(config.candidateDepth).toBe(200); // clamped to the maximum
  });

  it("replaces an all-zero weight set with the defaults", () => {
    const config = resolveDocsRetrievalConfig({
      docsBm25Weight: 0,
      docsKeywordWeight: 0,
      docsEmbeddingWeight: 0,
    });
    expect(config.weights).toEqual(DOCS_RETRIEVAL_DEFAULTS.weights);
  });

  it("lets validated overrides win over settings", () => {
    const config = resolveDocsRetrievalConfig(
      { docsBm25Weight: 0.7, docsRelevanceThreshold: 0.5 },
      {
        weights: { embedding: 0.9 },
        relevanceThreshold: 0.1,
        candidateDepth: 12,
      },
    );

    expect(config.weights).toEqual({
      bm25: 0.7,
      keyword: DOCS_RETRIEVAL_DEFAULTS.weights.keyword,
      embedding: 0.9,
    });
    expect(config.relevanceThreshold).toBe(0.1);
    expect(config.candidateDepth).toBe(12);
  });

  it("validates invalid overrides the same way as settings", () => {
    const base = resolveDocsRetrievalConfig({
      docsBm25Weight: 0.7,
      docsRelevanceThreshold: 0.5,
    });
    const config = resolveDocsRetrievalConfig(
      { docsBm25Weight: 0.7, docsRelevanceThreshold: 0.5 },
      {
        weights: { bm25: Number.NaN },
        relevanceThreshold: -2,
        candidateDepth: 9999,
      },
    );

    // Invalid override falls back to the settings-derived value.
    expect(config.weights.bm25).toBe(base.weights.bm25);
    // Out-of-range threshold clamps into [0,1] instead of being rejected.
    expect(config.relevanceThreshold).toBe(0);
    expect(config.candidateDepth).toBe(200);
  });

  it("resolves the bounded Jev settings with documented defaults", () => {
    const config = resolveDocsRetrievalConfig(null);
    expect(config.jev).toEqual(DOCS_RETRIEVAL_DEFAULTS.jev);
    // Off by default: search stays deterministic without an explicit opt-in.
    expect(config.jev.enabled).toBe(false);
  });

  it("applies valid Jev settings and validated Jev overrides", () => {
    const config = resolveDocsRetrievalConfig(
      {
        docsJevEnabled: true,
        docsJevCandidateLimit: 6,
        docsJevTimeoutMs: 1500,
        docsJevWeight: 0.75,
      },
      { jevCandidateLimit: 3 },
    );

    expect(config.jev).toEqual({
      enabled: true,
      candidateLimit: 3, // validated override wins
      timeoutMs: 1500,
      weight: 0.75,
    });
  });

  it("falls back or clamps invalid Jev settings deterministically", () => {
    const config = resolveDocsRetrievalConfig({
      docsJevEnabled: "yes" as unknown as boolean, // non-boolean → default (false)
      docsJevCandidateLimit: 0, // below range → clamped to 1
      docsJevTimeoutMs: 999_999, // above range → clamped to 30000
      docsJevWeight: Number.NaN, // non-finite → default 0.5
    });

    expect(config.jev.enabled).toBe(false);
    expect(config.jev.candidateLimit).toBe(1);
    expect(config.jev.timeoutMs).toBe(30_000);
    expect(config.jev.weight).toBe(DOCS_RETRIEVAL_DEFAULTS.jev.weight);
  });

  it("validates the jevEnabled override as an explicit boolean only", () => {
    const on = resolveDocsRetrievalConfig(null, { jevEnabled: true });
    expect(on.jev.enabled).toBe(true);

    const invalid = resolveDocsRetrievalConfig(
      { docsJevEnabled: true },
      { jevEnabled: "no" as unknown as boolean },
    );
    // Non-boolean override is ignored; the settings value survives.
    expect(invalid.jev.enabled).toBe(true);
  });
});

describe("resolveEffectiveCap", () => {
  const config = resolveDocsRetrievalConfig({ docsResultCap: 5 });

  it("uses the configured cap when the caller passes no limit", () => {
    expect(resolveEffectiveCap(config, undefined)).toBe(5);
  });

  it("lets callers request fewer results than the configured cap", () => {
    expect(resolveEffectiveCap(config, 2)).toBe(2);
    expect(resolveEffectiveCap(config, 1)).toBe(1);
  });

  it("never lets a caller exceed the configured cap", () => {
    expect(resolveEffectiveCap(config, 50)).toBe(5);
    expect(resolveEffectiveCap(config, 999)).toBe(5);
  });

  it("falls back to the configured cap for invalid limits", () => {
    expect(resolveEffectiveCap(config, Number.NaN)).toBe(5);
    expect(resolveEffectiveCap(config, "3")).toBe(5);
  });
});