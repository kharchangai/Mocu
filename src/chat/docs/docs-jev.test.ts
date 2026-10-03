import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{
    state: unknown;
    questions: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }>,
  impl: null as null | ((input: {
    state: unknown;
    questions: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) => unknown),
  settings: { decisionApiKey: "test-key" } as Record<string, unknown>,
  settingsError: null as Error | null,
}));

vi.mock("../../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision: vi.fn(async (input: {
    state: unknown;
    questions: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) => {
    state.calls.push(input);
    if (state.impl) {
      return state.impl(input);
    }
    throw new Error("no impl configured");
  }),
}));

vi.mock("../../store", () => ({
  readSettings: vi.fn(async () => {
    if (state.settingsError) {
      throw state.settingsError;
    }
    return { ...state.settings };
  }),
}));

import {
  MAX_JEV_CANDIDATES,
  MAX_STATE_CHARS,
  buildJevState,
  evaluateDocsJevRelevance,
  extractJevAnswer,
  refineHybridScore,
  truncateForJev,
} from "./docs-jev";
import { DOCS_RETRIEVAL_DEFAULTS } from "./docs-retrieval-config";
import type { DocsRetrievalConfig } from "./docs-retrieval-config";

function jevConfig(
  overrides: Partial<DocsRetrievalConfig["jev"]> = {},
): DocsRetrievalConfig {
  return {
    ...DOCS_RETRIEVAL_DEFAULTS,
    jev: { ...DOCS_RETRIEVAL_DEFAULTS.jev, enabled: true, ...overrides },
  };
}

function makeCandidates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `doc-${index + 1}`,
    title: `Doc ${index + 1} about retrieval`,
    description: `Description for document ${index + 1}.`,
  }));
}

function hybridScoresFor(
  candidates: ReadonlyArray<{ id: string }>,
): Map<string, number> {
  // Deterministic spread: first candidate 1.0, decreasing by 0.1.
  return new Map(
    candidates.map((candidate, index) => [
      candidate.id,
      Math.max(0, 1 - index * 0.1),
    ]),
  );
}

beforeEach(() => {
  state.calls = [];
  state.impl = null;
  state.settings = { decisionApiKey: "test-key" };
  state.settingsError = null;
});

describe("buildJevState / truncation", () => {
  it("sends only id/title/description and stays within the size budget", () => {
    const candidates = Array.from({ length: 50 }, (_, index) => ({
      id: `id-${index}`,
      title: "T".repeat(500),
      description: "D".repeat(2000),
    }));

    const serialized = buildJevState("query words SECRET_BODY", candidates);

    expect(serialized.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
    expect(serialized).toContain("Query: query words");
    // Truncation markers present for oversized fields.
    expect(serialized).toContain("…");
  });

  it("truncateForJev cuts at the limit without splitting surrogates", () => {
    expect(truncateForJev("abc", 10)).toBe("abc");
    const cut = truncateForJev("a😀bc", 3);
    expect(cut.length).toBeLessThanOrEqual(3);
    expect(cut.endsWith("…")).toBe(true);
    // The lone high surrogate must not remain at the boundary.
    const lastCode = cut.charCodeAt(cut.length - 2);
    expect(lastCode < 0xd800 || lastCode > 0xdbff).toBe(true);
  });
});

describe("extractJevAnswer", () => {
  it("accepts noul probabilities inside [0,1]", () => {
    expect(extractJevAnswer({ noul: 0.7 })).toEqual({
      kind: "noul",
      probability: 0.7,
    });
    expect(extractJevAnswer({ noul: "0.4" })).toEqual({
      kind: "noul",
      probability: 0.4,
    });
  });

  it("rejects noul values outside [0,1] as out-of-range", () => {
    expect(extractJevAnswer({ noul: 1.5 })).toEqual({
      kind: "invalid",
      source: "out-of-range",
    });
    expect(extractJevAnswer({ noul: -0.1 })).toEqual({
      kind: "invalid",
      source: "out-of-range",
    });
  });

  it("extracts valid probability maps and drops invalid entries", () => {
    expect(
      extractJevAnswer({ probabilities: { "1": 0.9, "2": 0.1 } }),
    ).toEqual({ kind: "probabilities", values: { "1": 0.9, "2": 0.1 } });

    // Mixed: valid entries survive, junk ignored.
    expect(
      extractJevAnswer({ probabilities: { "1": "0.6", "2": "junk" } }),
    ).toEqual({ kind: "probabilities", values: { "1": 0.6 } });

    // All out of range → out-of-range.
    expect(
      extractJevAnswer({ probabilities: { "1": 3, "2": -1 } }),
    ).toEqual({ kind: "invalid", source: "out-of-range" });
  });

  it("recognizes the single-choice shape and rejects malformed answers", () => {
    expect(extractJevAnswer({ choice: "1" })).toEqual({
      kind: "choice",
      key: "1",
    });
    expect(extractJevAnswer(null)).toEqual({
      kind: "invalid",
      source: "malformed",
    });
    expect(extractJevAnswer({ probabilities: {} })).toEqual({
      kind: "invalid",
      source: "malformed",
    });
    expect(extractJevAnswer({ foo: "bar" })).toEqual({
      kind: "invalid",
      source: "malformed",
    });
  });
});

describe("refineHybridScore", () => {
  it("applies the documented (1-w)*hybrid + w*probability formula", () => {
    expect(refineHybridScore(0.8, 0.4, 0.5)).toBeCloseTo(0.6, 10);
    expect(refineHybridScore(1, 0, 0.5)).toBeCloseTo(0.5, 10);
    expect(refineHybridScore(0, 1, 1)).toBeCloseTo(1, 10);
    // Weight 0 keeps the hybrid score.
    expect(refineHybridScore(0.7, 0.1, 0)).toBeCloseTo(0.7, 10);
    // Always clamped into [0,1].
    expect(refineHybridScore(1.5, 1.5, 0.5)).toBe(1);
    expect(refineHybridScore(-1, -1, 0.5)).toBe(0);
  });
});

describe("evaluateDocsJevRelevance — call bounds", () => {
  it("makes exactly ONE call and never exceeds the configured candidate limit", async () => {
    const candidates = makeCandidates(15);
    state.impl = () => ({
      answers: {
        doc_relevance: {
          probabilities: Object.fromEntries(
            candidates.map((_, index) => [String(index + 1), 0.5]),
          ),
        },
      },
    });

    const result = await evaluateDocsJevRelevance({
      query: "retrieval query",
      candidates,
      hybridScores: hybridScoresFor(candidates),
      config: jevConfig({ candidateLimit: 4 }),
      skipKeyCheck: false,
    });

    expect(state.calls).toHaveLength(1); // hard bound: one call per search

    const call = state.calls[0];
    // Explicit short timeout and an abort signal are always passed.
    expect(call.timeoutMs).toBe(DOCS_RETRIEVAL_DEFAULTS.jev.timeoutMs);
    expect(call.signal).toBeInstanceOf(AbortSignal);

    // Only the bounded top-N option keys were sent.
    const questions = call.questions as Record<
      string,
      { criteria: Record<string, string> }
    >;
    expect(Object.keys(questions.doc_relevance.criteria)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);

    // Returned evaluations cover only the bounded slice; the rest keeps
    // its hybrid score untouched (handled as "not-evaluated" by search).
    expect(result.size).toBe(4);
    expect(result.get("doc-1")?.source).toBe("jev");
    expect(result.has("doc-5")).toBe(false);
  });

  it("never exceeds MAX_JEV_CANDIDATES even with a larger limit", async () => {
    const candidates = makeCandidates(MAX_JEV_CANDIDATES + 10);
    state.impl = () => ({
      answers: { doc_relevance: { probabilities: { "1": 1 } } },
    });

    await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: hybridScoresFor(candidates),
      // Bypass config validation's range clamp the way a corrupt store could.
      config: jevConfig({ candidateLimit: 999 }),
      skipKeyCheck: true,
    });

    expect(state.calls).toHaveLength(1);
    const questions = state.calls[0].questions as Record<
      string,
      { criteria: Record<string, string> }
    >;
    expect(
      Object.keys(questions.doc_relevance.criteria).length,
    ).toBeLessThanOrEqual(MAX_JEV_CANDIDATES);
  });

  it("makes zero calls when disabled, key missing, or weight is 0", async () => {
    const candidates = makeCandidates(3);
    const scores = hybridScoresFor(candidates);

    // Disabled.
    let result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig({ enabled: false }),
    });
    expect(state.calls).toHaveLength(0);
    expect(result.get("doc-1")?.source).toBe("disabled");

    // Missing key: the settings check short-circuits before any call.
    state.settings = { decisionApiKey: "" };
    result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig(),
    });
    expect(state.calls).toHaveLength(0);
    expect(result.get("doc-1")?.source).toBe("no-key");

    // Unreadable settings also degrade to no-key without a call.
    state.settingsError = new Error("store broken");
    result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig(),
    });
    expect(state.calls).toHaveLength(0);
    expect(result.get("doc-1")?.source).toBe("no-key");

    // Weight 0 skips the network call entirely.
    state.settings = { decisionApiKey: "k" };
    result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig({ weight: 0 }),
    });
    expect(state.calls).toHaveLength(0);
    expect(result.get("doc-1")?.source).toBe("weight-zero");
    expect(result.get("doc-1")?.finalScore).toBeCloseTo(1, 10);
  });
});

describe("evaluateDocsJevRelevance — valid and malformed output", () => {
  it("maps valid probabilities with the gate+refine formula and retains both scores", async () => {
    const candidates = makeCandidates(2);
    const scores = new Map([
      ["doc-1", 0.8],
      ["doc-2", 0.4],
    ]);
    state.impl = () => ({
      answers: {
        doc_relevance: { probabilities: { "1": 0.2, "2": 1 } },
      },
    });

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig({ weight: 0.5 }),
      skipKeyCheck: true,
    });

    const first = result.get("doc-1")!;
    expect(first.probability).toBe(0.2);
    expect(first.source).toBe("jev");
    // hybrid retained: 0.5*0.8 + 0.5*0.2 = 0.5
    expect(first.hybridScore).toBeCloseTo(0.8, 10);
    expect(first.finalScore).toBeCloseTo(0.5, 10);

    const second = result.get("doc-2")!;
    expect(second.probability).toBe(1);
    expect(second.hybridScore).toBeCloseTo(0.4, 10);
    expect(second.finalScore).toBeCloseTo(0.7, 10); // 0.5*0.4 + 0.5*1
  });

  it("falls back deterministically on a malformed response", async () => {
    const candidates = makeCandidates(2);
    const scores = new Map([
      ["doc-1", 0.9],
      ["doc-2", 0.3],
    ]);
    state.impl = () => ({ nonsense: true });

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig(),
      skipKeyCheck: true,
    });

    expect(state.calls).toHaveLength(1);
    for (const candidate of candidates) {
      const entry = result.get(candidate.id)!;
      expect(entry.probability).toBeNull();
      expect(entry.source).toBe("malformed");
      // final === hybrid: nothing promoted or demoted.
      expect(entry.finalScore).toBe(entry.hybridScore);
    }
    expect(result.get("doc-2")?.finalScore).toBeCloseTo(0.3, 10);
  });

  it("drops out-of-range probabilities instead of applying them", async () => {
    const candidates = makeCandidates(1);
    state.impl = () => ({
      answers: { doc_relevance: { noul: 4.2 } },
    });

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: new Map([["doc-1", 0.5]]),
      config: jevConfig(),
      skipKeyCheck: true,
    });

    const entry = result.get("doc-1")!;
    expect(entry.probability).toBeNull();
    expect(entry.source).toBe("out-of-range");
    expect(entry.finalScore).toBeCloseTo(0.5, 10);
  });

  it("maps a single chosen option to probability 1/0", async () => {
    const candidates = makeCandidates(2);
    state.impl = () => ({
      answers: { doc_relevance: { choice: "2" } },
    });

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: new Map([
        ["doc-1", 0.7],
        ["doc-2", 0.5],
      ]),
      config: jevConfig({ weight: 1 }),
      skipKeyCheck: true,
    });

    expect(result.get("doc-1")?.probability).toBe(0);
    expect(result.get("doc-2")?.probability).toBe(1);
    expect(result.get("doc-2")?.finalScore).toBe(1);
  });

  it("ignores response keys outside the bounded slice", async () => {
    const candidates = makeCandidates(3);
    state.impl = () => ({
      answers: {
        doc_relevance: { probabilities: { "1": 1, "99": 1 } },
      },
    });

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: hybridScoresFor(candidates),
      config: jevConfig({ candidateLimit: 2 }),
      skipKeyCheck: true,
    });

    expect(result.get("doc-1")?.probability).toBe(1);
    // Outside the bounded slice: not evaluated, never expanded.
    expect(result.has("doc-3")).toBe(false);
  });
});

describe("evaluateDocsJevRelevance — failure policy", () => {
  it("classifies timeouts as timeout and keeps hybrid scores", async () => {
    const candidates = makeCandidates(2);
    state.impl = () => {
      const error = new Error("The operation timed out.");
      error.name = "TimeoutError";
      throw error;
    };

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: new Map([
        ["doc-1", 0.9],
        ["doc-2", 0.5],
      ]),
      config: jevConfig(),
      skipKeyCheck: true,
    });

    expect(state.calls).toHaveLength(1);
    for (const candidate of candidates) {
      const entry = result.get(candidate.id)!;
      expect(entry.source).toBe("timeout");
      expect(entry.probability).toBeNull();
      expect(entry.finalScore).toBe(entry.hybridScore);
    }
  });

  it("classifies external cancellation as cancelled", async () => {
    const candidates = makeCandidates(1);
    state.impl = () => {
      const error = new Error("The operation was cancelled.");
      error.name = "AbortError";
      throw error;
    };

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: new Map([["doc-1", 0.6]]),
      config: jevConfig(),
      skipKeyCheck: true,
    });

    expect(result.get("doc-1")?.source).toBe("cancelled");
    expect(result.get("doc-1")?.finalScore).toBeCloseTo(0.6, 10);
  });

  it("classifies HTTP/network failures and missing-key throws as fallbacks", async () => {
    const candidates = makeCandidates(1);
    const scores = new Map([["doc-1", 0.65]]);

    // Generic error → "error".
    state.impl = () => {
      throw new Error("OpenRouter Decisions API failed: HTTP 500");
    };
    let result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig(),
      skipKeyCheck: true,
    });
    expect(result.get("doc-1")?.source).toBe("error");
    expect(result.get("doc-1")?.finalScore).toBeCloseTo(0.65, 10);

    // Jev's own missing-key error → "no-key".
    state.impl = () => {
      throw new Error(
        "Decision API key is not configured. Open Settings and set the Decision (Jev) API key.",
      );
    };
    result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: scores,
      config: jevConfig(),
      skipKeyCheck: true,
    });
    expect(result.get("doc-1")?.source).toBe("no-key");
    expect(result.get("doc-1")?.finalScore).toBeCloseTo(0.65, 10);
  });

  it("returns the neutral fallback without a call when the signal is already aborted", async () => {
    const candidates = makeCandidates(1);
    const controller = new AbortController();
    controller.abort();

    const result = await evaluateDocsJevRelevance({
      query: "q",
      candidates,
      hybridScores: new Map([["doc-1", 0.5]]),
      config: jevConfig(),
      signal: controller.signal,
      skipKeyCheck: true,
    });

    expect(state.calls).toHaveLength(0);
    expect(result.get("doc-1")?.source).toBe("cancelled");
    expect(result.get("doc-1")?.finalScore).toBeCloseTo(0.5, 10);
  });
});