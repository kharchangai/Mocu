import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const tokenizeSimple = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[^a-z0-9\u0600-\u06FF]+/)
      .filter((token) => token.length > 0);

  class FakeDb {
    rows = new Map<string, Row>();
    meta = new Map<string, string>();
    executed: string[] = [];
    selectLog: Array<{ sql: string; params: unknown[] }> = [];
    ftsUnsupported = false;

    async execute(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rowsAffected: number }> {
      this.executed.push(sql);
      const s = sql.trim().toLowerCase();

      if (s.startsWith("create") || s.startsWith("drop")) {
        if (s.includes("create virtual table") && this.ftsUnsupported) {
          throw new Error("no such module: fts5");
        }
        if (s.includes("drop table if exists docs_index")) {
          this.rows.clear();
        }
        return { rowsAffected: 0 };
      }

      if (s.includes("insert or replace into docs_meta")) {
        this.meta.set(String(params[0]), String(params[1]));
        return { rowsAffected: 1 };
      }

      if (s.startsWith("insert into docs_index")) {
        const [
          id,
          path,
          title,
          description,
          keywords,
          search_text,
          content_hash,
          embedding,
          embedding_dim,
          embedding_model,
          embedded_at,
          updated_at,
        ] = params;
        this.rows.set(String(id), {
          id,
          path,
          title,
          description,
          keywords,
          search_text,
          content_hash,
          embedding,
          embedding_dim,
          embedding_model,
          embedded_at,
          updated_at,
        });
        return { rowsAffected: 1 };
      }

      if (s.includes("delete from docs_index where path")) {
        const [path, id] = params as [string, string];
        for (const [rowId, row] of this.rows) {
          if (row.path === path && rowId !== id) {
            this.rows.delete(rowId);
          }
        }
        return { rowsAffected: 0 };
      }

      if (s.includes("delete from docs_index where id")) {
        this.rows.delete(String(params[0]));
        return { rowsAffected: 0 };
      }

      if (s.includes("delete from docs_index")) {
        this.rows.clear();
        return { rowsAffected: 0 };
      }

      return { rowsAffected: 0 };
    }

    async select(sql: string, params: unknown[] = []): Promise<unknown[]> {
      const s = sql.trim().toLowerCase();
      this.selectLog.push({ sql: s, params });

      if (s === "select 1") {
        return [{ "1": 1 }];
      }

      if (s.includes("from docs_meta")) {
        const key = String(params[0]);
        return this.meta.has(key) ? [{ value: this.meta.get(key) }] : [];
      }

      // FTS5 BM25 candidate query: emulates MATCH + negative bm25 scoring.
      if (s.includes("from docs_fts") && s.includes("match ?")) {
        const matchExpr = String(params[0]);
        const limit = Number(params[1]);
        const tokens = (matchExpr.match(/"([^"]+)"/g) ?? []).map((token) =>
          token.replace(/"/g, ""),
        );

        const matches: Array<{ id: string; bm25_raw: number }> = [];
        for (const [id, row] of this.rows) {
          const counts = new Map<string, number>();
          for (const token of tokenizeSimple(String(row.search_text ?? ""))) {
            counts.set(token, (counts.get(token) ?? 0) + 1);
          }

          let occurrences = 0;
          let matched = false;
          for (const token of tokens) {
            const count = counts.get(token) ?? 0;
            if (count > 0) {
              matched = true;
              occurrences += count;
            }
          }
          if (!matched) {
            continue;
          }
          matches.push({ id, bm25_raw: -occurrences });
        }

        // More occurrences → more negative → better (SQLite ORDER BY ASC).
        matches.sort((a, b) => a.bm25_raw - b.bm25_raw);
        return matches.slice(0, limit);
      }

      // Keyword LIKE candidate query: params are `%token%` patterns + limit.
      if (s.includes("from docs_index") && s.includes("like ?")) {
        const limit = Number(params[params.length - 1]);
        const patterns = params
          .slice(0, -1)
          .map((pattern) => String(pattern).replace(/%/g, "").toLowerCase());

        const matches: Row[] = [];
        for (const row of this.rows.values()) {
          const haystacks = [row.title, row.description, row.keywords, row.search_text].map(
            (value) => String(value ?? "").toLowerCase(),
          );
          if (patterns.some((pattern) => haystacks.some((h) => h.includes(pattern)))) {
            matches.push(row);
          }
        }
        return matches.slice(0, limit);
      }

      // Bounded row fetch for FTS-only candidates.
      if (s.includes("id in (")) {
        return params
          .map((id) => this.rows.get(String(id)))
          .filter((row): row is Row => row !== undefined);
      }

      if (s.includes("from docs_index where id")) {
        const row = this.rows.get(String(params[0]));
        return row ? [row] : [];
      }

      if (s.includes("from docs_index")) {
        return Array.from(this.rows.values());
      }

      return [];
    }
  }

  return {
    files: new Map<string, string>(),
    settings: { embeddingModel: "model-a" } as Record<string, unknown>,
    embedCalls: [] as string[],
    embedError: null as Error | null,
    embedFn: (_text: string): number[] => [1, 0, 0],
    failLoad: false,
    readDirCalls: 0,
    db: new FakeDb(),
    FakeDb,
    // Jev integration test controls (mocked evaluateDocsJevRelevance).
    jevCalls: [] as Array<{
      query: string;
      candidates: Array<{ id: string; title: string; description: string }>;
      hybridScores: Map<string, number>;
    }>,
    jevImpl: null as
      | null
      | ((options: {
          query: string;
          candidates: Array<{ id: string; title: string; description: string }>;
          hybridScores: ReadonlyMap<string, number>;
        }) => Map<string, unknown>)
      | null,
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (path: string) => {
    if (state.files.has(path)) {
      return true;
    }
    for (const key of state.files.keys()) {
      if (key.startsWith(`${path}/`)) {
        return true;
      }
    }
    return false;
  }),
  mkdir: vi.fn(async () => undefined),
  readDir: vi.fn(async (dir: string) => {
    state.readDirCalls += 1;
    return Array.from(state.files.keys())
      .filter((key) => key.startsWith(`${dir}/`))
      .map((key) => ({ name: key.slice(dir.length + 1), isDirectory: false }));
  }),
  readTextFile: vi.fn(async (path: string) => {
    const content = state.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    state.files.set(path, content);
  }),
  remove: vi.fn(async (path: string) => {
    state.files.delete(path);
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:/appdata"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(async () => {
      if (state.failLoad) {
        throw new Error("database unavailable");
      }
      return state.db;
    }),
  },
}));

vi.mock("../../store", () => ({
  readSettings: vi.fn(async () => ({ ...state.settings })),
}));

vi.mock("../../services/ai/tools/textSimilarity", () => ({
  textSimilarity: {
    embedText: vi.fn(async (text: string) => {
      state.embedCalls.push(text);
      if (state.embedError) {
        throw state.embedError;
      }
      return state.embedFn(text);
    }),
  },
}));

/*
 * Jev stage mock: records every pipeline-level evaluation call (the pipeline
 * must make exactly ONE per search — the per-call bound on getJevDecision
 * itself is covered in docs-jev.test.ts) and lets tests inject the
 * evaluation map. The default is the deterministic disabled/fallback
 * result, mirroring real behavior for searches with Jev switched off.
 */
vi.mock("./docs-jev", () => ({
  evaluateDocsJevRelevance: vi.fn(
    async (options: {
      query: string;
      candidates: Array<{
        id: string;
        title: string;
        description: string;
      }>;
      hybridScores: ReadonlyMap<string, number>;
    }) => {
      state.jevCalls.push({
        query: options.query,
        candidates: options.candidates,
        hybridScores: new Map(options.hybridScores),
      });
      if (state.jevImpl) {
        return state.jevImpl(options);
      }
      const fallback = new Map<string, unknown>();
      for (const candidate of options.candidates) {
        const hybrid = options.hybridScores.get(candidate.id) ?? 0;
        fallback.set(candidate.id, {
          probability: null,
          hybridScore: hybrid,
          finalScore: hybrid,
          source: "disabled",
        });
      }
      return fallback;
    },
  ),
}));
import { serializeDoc } from "./doc-frontmatter";
import { resetDocsIndexStateForTests } from "./doc-index";
import {
  cosineSimilarity,
  countKeywordMatches,
  listDocs,
  minMaxNormalize,
  searchDocs,
} from "./doc-search";
import { buildDocsContextPrompt } from "./docs-context";

// Failure-path tests trigger expected index/search warnings; keep output clean.
vi.spyOn(console, "warn").mockImplementation(() => undefined);

function makeDoc(
  file: string,
  id: string,
  title: string,
  body: string,
  keywords: string[],
): void {
  const raw = serializeDoc(
    { id, title, description: `${title} description.`, keywords },
    body,
  );
  state.files.set(`docs/${file}`, raw);
}

/**
 * strong.md: the query token appears 5× in the body + 1× in keywords.
 * weak.md:   the query token appears exactly once, not in the metadata.
 */
function seedStandardDocs(): void {
  makeDoc(
    "strong.md",
    "strong",
    "Strong match",
    "retrieval retrieval retrieval retrieval retrieval filler words here",
    ["retrieval"],
  );
  makeDoc(
    "weak.md",
    "weak",
    "Weak match",
    "retrieval appears once plus other filler words",
    [],
  );
}

beforeEach(() => {
  state.files.clear();
  state.db = new state.FakeDb();
  state.settings = { embeddingModel: "model-a" };
  state.embedCalls = [];
  state.embedError = null;
  state.embedFn = () => [1, 0, 0];
  state.failLoad = false;
  state.readDirCalls = 0;
  state.jevCalls = [];
  state.jevImpl = null;
  resetDocsIndexStateForTests();
});

describe("normalization helpers", () => {
  it("minMaxNormalize handles empty, spread and equal inputs", () => {
    expect(minMaxNormalize(new Map()).size).toBe(0);

    const spread = minMaxNormalize(
      new Map([
        ["a", 6],
        ["b", 1],
      ]),
    );
    expect(spread.get("a")).toBe(1);
    expect(spread.get("b")).toBe(0);

    const equalPositive = minMaxNormalize(
      new Map([
        ["a", 2],
        ["b", 2],
      ]),
    );
    expect(equalPositive.get("a")).toBe(1);
    expect(equalPositive.get("b")).toBe(1);

    const equalZero = minMaxNormalize(
      new Map([
        ["a", 0],
        ["b", 0],
      ]),
    );
    expect(equalZero.get("a")).toBe(0);
    expect(equalZero.get("b")).toBe(0);
  });

  it("cosineSimilarity maps vectors onto [-1,1] with safe nulls", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([0, 0], [1, 1])).toBeNull();
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
  });

  it("countKeywordMatches counts unique query tokens found word-wise in metadata", () => {
    expect(countKeywordMatches(["alpha", "beta"], "alpha doc about alpha")).toBe(1);
    expect(countKeywordMatches(["alpha", "beta"], "alpha and beta here")).toBe(2);
    expect(countKeywordMatches(["alpha"], "no matches at all")).toBe(0);
    // word-wise matching: "cat" must not match "concatenate"
    expect(countKeywordMatches(["cat"], "concatenate the wires")).toBe(0);
    expect(countKeywordMatches([], "anything")).toBe(0);
  });
});

describe("hybrid search scoring", () => {
  it("combines BM25, keyword and embedding into component and combined scores", async () => {
    seedStandardDocs();

    const results = await searchDocs("retrieval");

    expect(results.map((result) => result.doc.file)).toEqual([
      "strong.md",
      "weak.md",
    ]);

    const [strong, weak] = results;
    // Min-max BM25: 6 occurrences vs 1 → 1.0 vs 0.0.
    expect(strong.raw.bm25).toBe(6);
    expect(weak.raw.bm25).toBe(1);
    expect(strong.scores.bm25).toBe(1);
    expect(weak.scores.bm25).toBe(0);
    // Keyword: strong has the token in metadata, weak does not.
    expect(strong.scores.keyword).toBe(1);
    expect(weak.scores.keyword).toBe(0);
    expect(strong.raw.keyword).toBe(1);
    expect(weak.raw.keyword).toBe(0);
    // Embedding: identical vectors → cosine 1 → clamped 1.
    expect(strong.scores.embedding).toBe(1);
    expect(weak.scores.embedding).toBe(1);
    expect(strong.raw.embedding).toBe(1);

    // Default weights 0.5 / 0.2 / 0.3 (sum 1).
    expect(strong.score).toBeCloseTo(1, 6);
    expect(weak.score).toBeCloseTo(0.3, 6);
    expect(strong.snippet.length).toBeGreaterThan(0);
  });

  it("ranks by BM25 with default weights and by embedding with embedding-only weights", async () => {
    seedStandardDocs();
    state.embedFn = (text: string) =>
      text.includes("Strong match") ? [1, 0, 0] : [0, 1, 0];

    const defaultRanked = await searchDocs("retrieval");
    expect(defaultRanked.map((result) => result.doc.file)).toEqual([
      "strong.md",
      "weak.md",
    ]);
    expect(defaultRanked[0].score).toBeCloseTo(0.7, 6); // bm25+keyword, no embedding credit
    expect(defaultRanked[1].score).toBeCloseTo(0.3, 6); // embedding only

    const embeddingRanked = await searchDocs("retrieval", {
      weights: { bm25: 0, keyword: 0, embedding: 1 },
      relevanceThreshold: 0,
    });
    expect(embeddingRanked.map((result) => result.doc.file)).toEqual([
      "weak.md",
      "strong.md",
    ]);
    expect(embeddingRanked[0].scores).toEqual({
      bm25: 0,
      keyword: 0,
      embedding: 1,
    });
    expect(embeddingRanked[1].scores).toEqual({
      bm25: 1,
      keyword: 1,
      embedding: 0,
    });
  });

  it("re-normalizes weights when no embedding is available at all", async () => {
    seedStandardDocs();
    state.settings = { embeddingModel: "" }; // no model → no stored vectors

    const results = await searchDocs("retrieval");

    // Weak doc drops below the threshold once its only signal disappears.
    expect(results.map((result) => result.doc.file)).toEqual(["strong.md"]);
    const strong = results[0];
    expect(strong.scores.embedding).toBeNull();
    expect(strong.scores.bm25).toBe(1);
    expect(strong.scores.keyword).toBe(1);
    // (0.5·1 + 0.2·1) / 0.7 = 1 — the embedding weight is redistributed.
    expect(strong.score).toBeCloseTo(1, 6);
  });

  it("scores a candidate missing its stored embedding 0 for that component", async () => {
    seedStandardDocs();
    await searchDocs("retrieval"); // reconcile stores vectors for both docs

    const strongRow = state.db.rows.get("strong")!;
    strongRow.embedding = null;
    strongRow.embedding_model = null;

    const results = await searchDocs("retrieval");
    const byFile = new Map(results.map((result) => [result.doc.file, result]));
    const strong = byFile.get("strong.md")!;
    const weak = byFile.get("weak.md")!;

    expect(strong.scores.embedding).toBe(0);
    expect(strong.raw.embedding).toBeNull();
    // Weight still counted: (0.5·1 + 0.2·1 + 0.3·0) / 1 = 0.7
    expect(strong.score).toBeCloseTo(0.7, 6);
    expect(weak.scores.embedding).toBe(1);
    expect(weak.raw.embedding).toBe(1);
    expect(weak.score).toBeCloseTo(0.3, 6);
  });

  it("ignores stored vectors produced by a different embedding model", async () => {
    seedStandardDocs();
    await searchDocs("retrieval"); // indexed with model-a
    expect(state.embedCalls.length).toBe(3); // 2 docs + 1 query

    state.settings = { embeddingModel: "model-b" }; // configured model changes
    const results = await searchDocs("retrieval", { relevanceThreshold: 0 });

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.scores.embedding).toBeNull();
    }
    // No model-b candidate vector → the query is never embedded.
    expect(state.embedCalls.length).toBe(3);
  });
});

describe("threshold, cap and candidate depth", () => {
  it("applies the relevance threshold independently of the result cap", async () => {
    seedStandardDocs();

    // Threshold alone cuts the weak doc although cap=5 would allow it.
    state.settings = {
      embeddingModel: "model-a",
      docsRelevanceThreshold: 0.95,
    };
    const thresholdCut = await searchDocs("retrieval");
    expect(thresholdCut.map((result) => result.doc.file)).toEqual(["strong.md"]);

    // Cap alone cuts the weak doc when the threshold lets everything through.
    const capCut = await searchDocs("retrieval", {
      relevanceThreshold: 0,
      limit: 1,
    });
    expect(capCut.map((result) => result.doc.file)).toEqual(["strong.md"]);

    // With neither filter active, both docs come back.
    const unfiltered = await searchDocs("retrieval", {
      relevanceThreshold: 0,
    });
    expect(unfiltered).toHaveLength(2);
  });

  it("uses the configured result cap as an absolute ceiling", async () => {
    seedStandardDocs();
    state.settings = { embeddingModel: "model-a", docsResultCap: 1 };

    const results = await searchDocs("retrieval", 5); // caller asks for more

    expect(results).toHaveLength(1);
    expect(results[0].doc.file).toBe("strong.md");
  });

  it("keeps retrieval candidate depth distinct from the final result cap", async () => {
    seedStandardDocs();
    state.settings = {
      embeddingModel: "model-a",
      docsCandidateDepth: 7,
      docsResultCap: 2,
    };

    const results = await searchDocs("retrieval");
    expect(results).toHaveLength(2); // capped by docsResultCap

    const limitedSelects = state.db.selectLog.filter((entry) =>
      entry.sql.includes("limit ?"),
    );
    expect(limitedSelects.length).toBeGreaterThan(0);
    for (const entry of limitedSelects) {
      // SQL candidate queries are bounded by candidateDepth (7), not cap (2).
      expect(entry.params[entry.params.length - 1]).toBe(7);
    }
  });

  it("returns nothing for queries without lexical tokens", async () => {
    seedStandardDocs();
    expect(await searchDocs("the and of")).toEqual([]);
    expect(await searchDocs("   ")).toEqual([]);
  });
});

describe("deterministic ordering and bounded execution", () => {
  it("breaks exact ties deterministically by path", async () => {
    makeDoc("zebra.md", "z", "Tie doc", "shared topic body with content", ["shared"]);
    makeDoc("alpha.md", "a", "Tie doc", "shared topic body with content", ["shared"]);

    const results = await searchDocs("shared");

    expect(results.map((result) => result.doc.file)).toEqual([
      "alpha.md",
      "zebra.md",
    ]);
    expect(results[0].score).toBe(results[1].score);
  });

  it("never re-enumerates the full doc folder or re-embeds docs per warm query", async () => {
    seedStandardDocs();
    await searchDocs("retrieval"); // initial reconcile (reads the folder once)

    state.readDirCalls = 0;
    state.db.selectLog = [];
    const embedCallsBefore = state.embedCalls.length;

    const results = await searchDocs("retrieval");

    expect(results).toHaveLength(2);
    expect(state.readDirCalls).toBe(0); // no readAllDocs enumeration
    // Only the query embedding is computed; stored doc vectors are reused.
    expect(state.embedCalls.length).toBe(embedCallsBefore + 1);

    // Every catalog/FTS query of a warm search is bounded.
    const catalogQueries = state.db.selectLog.filter(
      (entry) =>
        entry.sql.includes("docs_index") || entry.sql.includes("docs_fts"),
    );
    expect(catalogQueries.length).toBeGreaterThan(0);
    for (const entry of catalogQueries) {
      expect(
        entry.sql.includes("limit ?") ||
          entry.sql.includes("id in (") ||
          entry.sql.includes("where id = ?"),
      ).toBe(true);
    }
  });
});

describe("fallbacks", () => {
  it("falls back to lexical in-memory BM25 when SQLite is unavailable", async () => {
    seedStandardDocs();
    state.failLoad = true;

    const results = await searchDocs("retrieval");

    expect(results.map((result) => result.doc.file)).toEqual(["strong.md"]);
    const strong = results[0];
    expect(strong.scores.bm25).not.toBeNull();
    expect(strong.scores.keyword).not.toBeNull();
    expect(strong.scores.embedding).toBeNull();
    expect(strong.score).toBeGreaterThan(0);
  });

  it("degrades to keyword + embedding when FTS5 is unavailable", async () => {
    seedStandardDocs();
    state.db.ftsUnsupported = true;

    const results = await searchDocs("retrieval");

    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.scores.bm25).toBeNull();
      expect(result.scores.keyword).not.toBeNull();
      expect(result.scores.embedding).not.toBeNull();
    }
    // Weights re-normalized over keyword + embedding (0.2 + 0.3 = 0.5):
    // strong = (0.2·1 + 0.3·1) / 0.5 = 1, weak = (0.2·0 + 0.3·1) / 0.5 = 0.6
    expect(results[0].doc.file).toBe("strong.md");
    expect(results[0].score).toBeCloseTo(1, 6);
    expect(results[1].score).toBeCloseTo(0.6, 6);
  });

  it("keeps search working when the embedding provider fails", async () => {
    seedStandardDocs();
    state.embedError = new Error("embedding provider down");

    const results = await searchDocs("retrieval");

    // Docs stay lexically searchable; the embedding signal drops out (its
    // weight is re-normalized onto BM25 + keyword) and the weak doc ends up
    // at combined score 0, below the default relevance threshold.
    expect(results.map((result) => result.doc.file)).toEqual(["strong.md"]);
    expect(results[0].scores.embedding).toBeNull();
    expect(results[0].scores.bm25).toBe(1);
    expect(results[0].score).toBeCloseTo(1, 6); // (0.5+0.2)/0.7
  });
});

describe("listDocs", () => {
  it("returns every doc without searching", async () => {
    seedStandardDocs();
    const docs = await listDocs();
    expect(docs.map((doc) => doc.file).sort()).toEqual([
      "strong.md",
      "weak.md",
    ]);
  });
});

describe("docs-context prompt injection", () => {
  it("emits only capped references + approved metadata — never bodies or snippets", async () => {
    makeDoc(
      "strong.md",
      "strong",
      "Strong match",
      "retrieval retrieval retrieval retrieval retrieval SECRET_BODY_MARKER_XYZ",
      ["retrieval"],
    );
    makeDoc(
      "other.md",
      "other",
      "Other match",
      "retrieval retrieval retrieval retrieval retrieval retrieval other filler",
      ["retrieval", "other"],
    );

    const prompt = await buildDocsContextPrompt("retrieval");

    // Approved metadata is present.
    expect(prompt).toContain('file: "strong.md"');
    expect(prompt).toContain("id: strong");
    expect(prompt).toContain("title: Strong match");
    expect(prompt).toContain("description: Strong match description.");
    expect(prompt).toContain("keywords: retrieval");
    // Agent-read instruction + link guidance present.
    expect(prompt).toContain("read_knowledge_doc");
    expect(prompt).toContain("descriptive leads");
    // NEVER bodies, snippets or search internals.
    expect(prompt).not.toContain("SECRET_BODY_MARKER_XYZ");
    expect(prompt).not.toContain("retrieval retrieval retrieval");
    expect(prompt).not.toMatch(/\b(bm25|keyword|embedding|hybridScore|score)\b:/i);
  });

  it("caps references at MAX_CONTEXT_DOCS even when more results pass", async () => {
    // Three docs that all match; default context cap is 2.
    for (const name of ["one", "two", "three"]) {
      makeDoc(
        `${name}.md`,
        name,
        `Doc ${name}`,
        `retrieval retrieval retrieval retrieval retrieval body of ${name}`,
        ["retrieval"],
      );
    }

    const prompt = await buildDocsContextPrompt("retrieval");

    const fileLines = prompt
      .split("\n")
      .filter((line) => line.startsWith("- file:"));
    expect(fileLines).toHaveLength(2);
    expect(prompt).toContain("max 2");
    // Explicit override is honored.
    const cappedAtOne = await buildDocsContextPrompt("retrieval", {
      docsLimit: 1,
    });
    expect(
      cappedAtOne.split("\n").filter((line) => line.startsWith("- file:")),
    ).toHaveLength(1);
    expect(cappedAtOne).toContain("max 1");
  });

  it("honors threshold-derived selections: nothing selected → empty prompt", async () => {
    seedStandardDocs();
    // Threshold keeps only the strong doc (see the threshold tests above).
    state.settings = {
      embeddingModel: "model-a",
      docsRelevanceThreshold: 0.95,
    };

    const prompt = await buildDocsContextPrompt("retrieval");
    expect(prompt).toContain('file: "strong.md"');
    expect(prompt).not.toContain("weak.md");

    // Threshold above everything → no selection → fail-open empty string.
    state.settings = {
      embeddingModel: "model-a",
      docsRelevanceThreshold: 1,
    };
    // strong scores 1.0 exactly and passes 1.0; raise expectation with a
    // query nothing matches to get a truly empty selection.
    const noMatch = await buildDocsContextPrompt("zzz-not-present-anywhere");
    expect(noMatch).toBe("");
  });

  it("escapes untrusted metadata so it renders inert", async () => {
    makeDoc(
      "esc.md",
      "esc",
      "Title with **bold** and [link](http://x) <script>alert(1)</script>",
      "retrieval body content here",
      ["kw_with_underscore", "kw*star`tick"],
    );

    const prompt = await buildDocsContextPrompt("retrieval");

    // Markdown structure + HTML are neutralized.
    expect(prompt).not.toContain("**bold**");
    expect(prompt).toContain("\\*\\*bold\\*");
    expect(prompt).not.toContain("<script>");
    expect(prompt).toContain("&lt;script&gt;");
    expect(prompt).toContain("\\[link\\]");
    expect(prompt).toContain("kw\\_with\\_underscore");
    // Reference structure survives escaping.
    expect(prompt).toContain('file: "esc.md"');
    expect(prompt).toContain("id: esc");
  });

  it("fails open on empty input without searching", async () => {
    const emptyInput = await buildDocsContextPrompt("   ");
    expect(emptyInput).toBe("");
  });
});

describe("Jev relevance stage integration", () => {
  /** Builds an evaluation map that mimics the docs-jev module contract. */
  function evaluationMap(
    options: {
      candidates: Array<{ id: string }>;
      hybridScores: ReadonlyMap<string, number>;
    },
    probabilities: Record<string, number | null>,
    source: string = "jev",
  ): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const candidate of options.candidates) {
      const hybrid = options.hybridScores.get(candidate.id) ?? 0;
      const probability = probabilities[candidate.id] ?? null;
      if (probability === null || source !== "jev") {
        map.set(candidate.id, {
          probability: null,
          hybridScore: hybrid,
          finalScore: hybrid,
          source: probability === null ? source : "jev",
        });
      } else {
        map.set(candidate.id, {
          probability,
          hybridScore: hybrid,
          finalScore: Math.min(
            1,
            Math.max(0, 0.5 * hybrid + 0.5 * probability),
          ),
          source: "jev",
        });
      }
    }
    return map;
  }

  it("makes exactly one bounded stage call per search and passes compact candidates", async () => {
    seedStandardDocs();

    const results = await searchDocs("retrieval");
    expect(results).toHaveLength(2);

    // ONE stage invocation for the whole search (never per document).
    expect(state.jevCalls).toHaveLength(1);
    const call = state.jevCalls[0];
    expect(call.query).toBe("retrieval");
    expect(call.candidates).toHaveLength(2);
    // Only id/title/description are projected — no body/keywords fields.
    for (const candidate of call.candidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        "description",
        "id",
        "title",
      ]);
    }
    // Hybrid scores handed to the stage match the pre-Jev values.
    expect(call.hybridScores.get("strong")).toBeCloseTo(1, 6);
    expect(call.hybridScores.get("weak")).toBeCloseTo(0.3, 6);
  });

  it("applies valid probabilities with gate+refine, retains both scores, and re-ranks", async () => {
    seedStandardDocs();
    state.jevImpl = (options) =>
      evaluationMap(options, { strong: 0.2, weak: 1.0 });

    const results = await searchDocs("retrieval");

    expect(results.map((result) => result.doc.file)).toEqual([
      "weak.md",
      "strong.md",
    ]);

    const weak = results[0];
    const strong = results[1];

    // Weak: final = 0.5·0.3 + 0.5·1.0 = 0.65; hybrid retained.
    expect(weak.jev.applied).toBe(true);
    expect(weak.jev.probability).toBe(1);
    expect(weak.jev.source).toBe("jev");
    expect(weak.jev.hybridScore).toBeCloseTo(0.3, 6);
    expect(weak.score).toBeCloseTo(0.65, 6);

    // Strong: final = 0.5·1.0 + 0.5·0.2 = 0.6; hybrid retained.
    expect(strong.jev.applied).toBe(true);
    expect(strong.jev.probability).toBe(0.2);
    expect(strong.jev.hybridScore).toBeCloseTo(1, 6);
    expect(strong.score).toBeCloseTo(0.6, 6);
    // Both values are present on the result (refined + original).
    expect(strong.jev.weight).toBeCloseTo(0.5, 6);
  });

  it("applies the relevance threshold to the FINAL score, independently of the cap", async () => {
    seedStandardDocs();
    // Jev pushes weak up (0.65) and strong down (0.5).
    state.jevImpl = (options) =>
      evaluationMap(options, { strong: 0, weak: 1 });
    state.settings = {
      embeddingModel: "model-a",
      docsRelevanceThreshold: 0.6,
    };

    const results = await searchDocs("retrieval");

    // Threshold on the refined score: strong (0.5) is cut even though its
    // hybrid score was 1.0 — the threshold stage sees only final scores.
    expect(results.map((result) => result.doc.file)).toEqual(["weak.md"]);
    expect(results[0].score).toBeCloseTo(0.65, 6);

    // Cap stays a separate control: with threshold off and limit=1 the
    // refined ranking still truncates after the threshold passes.
    const capped = await searchDocs("retrieval", {
      relevanceThreshold: 0,
      limit: 1,
    });
    expect(capped).toHaveLength(1);
    expect(capped[0].doc.file).toBe("weak.md"); // final-score order
  });

  it("falls back deterministically on failure: no promotion, hybrid retained", async () => {
    seedStandardDocs();
    // Simulate a timeout/failure evaluation: probability null, final = hybrid.
    state.jevImpl = (options) => evaluationMap(options, {}, "timeout");

    const results = await searchDocs("retrieval");

    const byFile = new Map(results.map((result) => [result.doc.file, result]));
    const strong = byFile.get("strong.md")!;
    const weak = byFile.get("weak.md")!;

    expect(strong.jev.applied).toBe(false);
    expect(strong.jev.source).toBe("timeout");
    expect(strong.jev.probability).toBeNull();
    expect(strong.score).toBeCloseTo(1, 6); // unchanged hybrid
    expect(strong.jev.hybridScore).toBeCloseTo(1, 6);

    // Weak doc was BELOW-threshold-adjacent before; the failed Jev call must
    // not promote or demote it: score stays exactly the hybrid value.
    expect(weak.score).toBeCloseTo(0.3, 6);
    expect(weak.jev.applied).toBe(false);

    // Threshold still governs the unchanged hybrid scores (0.3 ≥ 0.2 default).
    expect(results.map((result) => result.doc.file)).toEqual([
      "strong.md",
      "weak.md",
    ]);
  });

  it("runs the stage on the lexical fallback path too — still one call", async () => {
    seedStandardDocs();
    state.failLoad = true; // SQLite unavailable → lexical BM25 path

    const results = await searchDocs("retrieval");

    expect(results.length).toBeGreaterThan(0);
    expect(state.jevCalls).toHaveLength(1);
    for (const result of results) {
      expect(result.jev.hybridScore).toBeCloseTo(result.score, 6);
    }
  });

  it("default disabled stage keeps every result deterministic (no Jev data applied)", async () => {
    seedStandardDocs();

    const results = await searchDocs("retrieval");

    // Default mock returns the disabled/fallback evaluation.
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.jev.applied).toBe(false);
      expect(result.jev.probability).toBeNull();
      expect(result.jev.source).toBe("disabled");
      expect(result.score).toBe(result.jev.hybridScore);
    }
    // Scores identical to the pre-Jev hybrid baseline.
    expect(results[0].score).toBeCloseTo(1, 6);
    expect(results[1].score).toBeCloseTo(0.3, 6);
  });
});