import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end (mock-backed) integration scenario for the docs replacement:
 *
 *   - global content/index location (AppData/docs, never the repo)
 *   - legacy `name` frontmatter migration/readability + indexing
 *   - create / update / delete index synchronization with hash+model
 *     embedding reuse
 *   - hybrid normalized weighted ranking (BM25 / keyword / embedding flip)
 *   - ONE bounded Jev evaluation per search, with timeout fallback
 *   - relevance threshold independent from the result cap (on final score)
 *   - metadata-only prompt injection
 *   - agent-invoked linked read (explicit, never crawled)
 *
 * Real SQLite and the real embedding/Jev HTTP providers cannot run in this
 * environment, so the Tauri SQL plugin, the FS plugin, the embedding
 * provider, the LLM and getJevDecision are mocked here. The REAL
 * doc-storage / doc-index / doc-search / docs-jev / docs-context /
 * doc-link-resolver / docs_tools modules run unmocked on top of those
 * fakes, so every pipeline rule under test is the production code.
 */

const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  const tokenizeSimple = (text: string): string[] =>
    text
      .toLowerCase()
      .split(/[^a-z0-9\u0600-\u06FF]+/)
      .filter((token) => token.length > 0);

  /**
   * Fake SQLite catalog that understands exactly the SQL the docs modules
   * issue: schema DDL, meta upserts, the docs_index upsert/delete ladder,
   * FTS5 MATCH + bm25() candidates, keyword LIKE candidates and bounded
   * id IN (...) hydration.
   */
  class FakeDb {
    rows = new Map<string, Row>();
    meta = new Map<string, string>();
    executed: string[] = [];

    async execute(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rowsAffected: number }> {
      this.executed.push(sql);
      const s = sql.trim().toLowerCase();

      if (s.startsWith("create") || s.startsWith("drop")) {
        if (s.includes("drop table if exists docs_index")) {
          this.rows.clear();
        }
        return { rowsAffected: 0 };
      }

      if (s.includes("insert or replace into docs_meta")) {
        this.meta.set(String(params[0]), String(params[1]));
        return { rowsAffected: 1 };
      }

      if (s.includes("insert into docs_index")) {
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
        const [path, keepId] = params as [string, string | undefined];
        for (const [rowId, row] of this.rows) {
          if (row.path === path && (keepId === undefined || rowId !== keepId)) {
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

      if (s === "select 1") {
        return [{ "1": 1 }];
      }

      if (s.includes("from docs_meta")) {
        const key = String(params[0]);
        return this.meta.has(key) ? [{ value: this.meta.get(key) }] : [];
      }

      // FTS5 BM25 candidate query: emulates MATCH + bm25() ordering
      // (more occurrences → more negative bm25 → better in ORDER BY ASC).
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
    embedFn: (_text: string): number[] => [1, 0, 0],
    db: new FakeDb(),
    FakeDb,
    jevCalls: [] as Array<{
      state?: unknown;
      timeoutMs?: unknown;
      questions?: unknown;
    }>,
    jevImpl: null as null | ((options: Record<string, unknown>) => unknown),
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
  readDir: vi.fn(async (dir: string) =>
    Array.from(state.files.keys())
      .filter((key) => key.startsWith(`${dir}/`))
      .map((key) => ({ name: key.slice(dir.length + 1), isDirectory: false })),
  ),
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
    load: vi.fn(async () => state.db),
  },
}));

vi.mock("../../store", () => ({
  readSettings: vi.fn(async () => ({ ...state.settings })),
}));

vi.mock("../../services/ai/tools/textSimilarity", () => ({
  textSimilarity: {
    embedText: vi.fn(async (text: string) => {
      state.embedCalls.push(text);
      return state.embedFn(text);
    }),
  },
}));

vi.mock("../../services/ai/llm", () => ({
  getAsyncLLM: vi.fn(async () => ({
    invoke: vi.fn(async () => ({ content: "" })),
  })),
}));

/*
 * getJevDecision is mocked, but the REAL docs-jev module runs on top of it,
 * so the bound/timeout/refinement rules under test are production code.
 */
vi.mock("../../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision: vi.fn(async (options: Record<string, unknown>) => {
    state.jevCalls.push(options as (typeof state.jevCalls)[number]);
    if (state.jevImpl) {
      return state.jevImpl(options);
    }
    throw new Error("Jev is not configured for this test.");
  }),
}));

import { readDocTool } from "../../services/ai/tools/docs_tools";
import { resetDocsIndexStateForTests } from "./doc-index";
import { serializeDoc } from "./doc-frontmatter";
import { buildDocsContextPrompt } from "./docs-context";
import { docsIndexDatabaseUrl } from "./docs-index-db";
import { deleteDoc, saveDoc, writeDocFile } from "./doc-storage";
import { listDocs, searchDocs } from "./doc-search";

// Failure-path tests trigger expected fallback warnings; keep output clean.
vi.spyOn(console, "warn").mockImplementation(() => undefined);

const DOCS_DIR = dirname(fileURLToPath(import.meta.url));
function seedDoc(
  file: string,
  id: string,
  title: string,
  description: string,
  keywords: string[],
  body: string,
): void {
  state.files.set(
    `docs/${file}`,
    serializeDoc({ id, title, description, keywords }, body),
  );
}

/**
 * Three docs matching the query token "retrieval" with deliberately
 * different signal profiles (see the hybrid ranking test):
 *   alpha:  fewest BM25 occurrences,  best embedding,   no keyword hit
 *   beta:   most BM25 occurrences,     worst embedding,  keyword hit
 *   gamma:  middle BM25,               best embedding,   keyword hit
 */
function seedRetrievalDocs(): void {
  seedDoc(
    "alpha.md",
    "alpha",
    "Alpha",
    "Alpha doc",
    ["alpha"],
    "retrieval appears here exactly once",
  );
  seedDoc(
    "beta.md",
    "beta",
    "Beta retrieval retrieval",
    "Beta doc",
    ["retrieval", "beta"],
    "retrieval retrieval retrieval retrieval",
  );
  seedDoc(
    "gamma.md",
    "gamma",
    "Gamma retrieval",
    "Gamma doc",
    ["gamma"],
    "retrieval retrieval retrieval",
  );
}

/** Deterministic per-document embedding vectors (docs vs. the query). */
function defaultEmbedFn(text: string): number[] {
  if (text.includes("Alpha")) return [1, 0, 0];
  if (text.includes("Beta")) return [0, 1, 0];
  return [1, 0, 0]; // "Gamma" and every query fall here
}

beforeEach(() => {
  vi.clearAllMocks(); // reset FS/SQL call logs between tests
  state.files.clear();
  state.db = new state.FakeDb();
  state.settings = { embeddingModel: "model-a" };
  state.embedCalls = [];
  state.embedFn = defaultEmbedFn;
  state.jevCalls = [];
  state.jevImpl = null;
  resetDocsIndexStateForTests();
});

describe("global-content-only location and single-retriever guarantees", () => {
  it("keeps the index DB inside the global AppData docs folder", async () => {
    expect(await docsIndexDatabaseUrl()).toBe("sqlite:C:/appdata/docs/docs.db");
  });

  it("never writes doc content into the repository source tree", async () => {
    await saveDoc(
      { id: "repo-guard", title: "Repo Guard", description: "Guard.", keywords: ["guard"] },
      "Body.",
    );
    expect(state.files.size).toBe(1);
    expect([...state.files.keys()].every((key) => key.startsWith("docs/"))).toBe(
      true,
    );
  });

  it("src/chat/docs contains only code and exports no stale retriever", () => {
    const entries = readdirSync(DOCS_DIR);
    expect(entries.every((entry) => entry.endsWith(".ts"))).toBe(true);

    const barrel = readFileSync(join(DOCS_DIR, "index.ts"), "utf8");
    // The retired section-finder (second, unbounded Jev pattern) must not
    // be re-exported: searchDocs is the only active doc retriever.
    expect(barrel).not.toContain("doc-section-finder");
    expect(barrel).not.toContain("findRelevantSection");
    expect(barrel).not.toContain("splitDocIntoSections");
  });
});

describe("global legacy migration", () => {
  function seedLegacyDoc(): void {
    state.files.set(
      "docs/legacy-note.md",
      [
        "---",
        "name: Legacy Note",
        "description: A legacy note about migration.",
        "keywords: legacy, migration",
        "---",
        "",
        "Legacy body with a [descriptive link](other.md).",
        "",
      ].join("\n"),
    );
  }

  it("reads, lists and indexes a legacy `name` doc end to end", async () => {
    seedLegacyDoc();

    const results = await searchDocs("legacy");

    expect(results.map((r) => r.doc.file)).toEqual(["legacy-note.md"]); // debug
    const doc = results[0].doc;
    expect(doc.file).toBe("legacy-note.md");
    expect(doc.title).toBe("Legacy Note"); // name → title
    expect(doc.id).toBe("legacy-note"); // deterministic file-name id
    expect(doc.keywords).toEqual(["legacy", "migration"]); // comma string
    expect(doc.body).toContain("[descriptive link](other.md)"); // links kept

    // The reconcile that ran before search indexed the doc with the full
    // catalog metadata: hash + model + one embedding.
    const row = state.db.rows.get("legacy-note");
    expect(row).toBeDefined();
    expect(row?.title).toBe("Legacy Note");
    expect(row?.path).toBe("legacy-note.md");
    expect(String(row?.content_hash ?? "")).toHaveLength(64);
    expect(row?.embedding_model).toBe("model-a");
    // One doc embedding from reconcile + one query embedding from search.
    expect(
      state.embedCalls.filter((text) => text.includes("Legacy Note")),
    ).toHaveLength(1);
    expect(state.embedCalls.length).toBeGreaterThanOrEqual(1); // query embed too

    const listed = await listDocs();
    expect(listed.map((entry) => entry.id)).toContain("legacy-note");
  });

  it("rewrites the legacy frontmatter into the new schema on update", async () => {
    seedLegacyDoc();

    await writeDocFile(
      "legacy-note.md",
      {
        id: "legacy-note",
        title: "Legacy Note",
        description: "A legacy note about migration.",
        keywords: ["legacy", "migration"],
      },
      "Legacy body with a [descriptive link](other.md).",
    );

    const raw = state.files.get("docs/legacy-note.md") ?? "";
    expect(raw).toContain("id: legacy-note");
    expect(raw).toContain("title: Legacy Note");
    expect(raw).not.toMatch(/(^|\n)name:/);
    expect(raw).toContain("[descriptive link](other.md)");
  });
});

describe("create/update/delete synchronize the index with hash/model reuse", () => {
  const meta = {
    id: "fresh",
    title: "Fresh Doc",
    description: "A fresh doc.",
    keywords: ["fresh"],
  };

  it("saves, reuses the embedding on unchanged content, re-embeds on content or model change, deletes", async () => {
    // CREATE: file + index row + one embedding.
    const fileName = await saveDoc(meta, "Original body.");
    expect(fileName).toBe("fresh-doc.md");
    expect(state.files.has("docs/fresh-doc.md")).toBe(true);
    const row = state.db.rows.get("fresh");
    expect(row?.path).toBe("fresh-doc.md");
    expect(row?.embedding_model).toBe("model-a");
    expect(state.embedCalls).toHaveLength(1);

    // UPDATE (unchanged content): SHA-256 hash matches → embedding reused.
    await writeDocFile(fileName, meta, "Original body.");
    expect(state.embedCalls).toHaveLength(1);
    expect(state.db.rows.get("fresh")?.embedding_model).toBe("model-a");

    // UPDATE (changed content): hash changes → fresh embedding.
    await writeDocFile(fileName, meta, "Original body. Added a sentence.");
    expect(state.embedCalls).toHaveLength(2);

    // UPDATE (changed model): same content, different model → re-embed.
    state.settings.embeddingModel = "model-b";
    await writeDocFile(fileName, meta, "Original body. Added a sentence.");
    expect(state.embedCalls).toHaveLength(3);
    expect(state.db.rows.get("fresh")?.embedding_model).toBe("model-b");

    // DELETE: file and row are both gone.
    await deleteDoc(fileName);
    expect(state.files.has("docs/fresh-doc.md")).toBe(false);
    expect(state.db.rows.has("fresh")).toBe(false);
  });
});

describe("hybrid normalized weighted ranking, threshold and cap", () => {
  beforeEach(() => {
    seedRetrievalDocs();
  });

  it("combines all three normalized signals under the default weights", async () => {
    const results = await searchDocs("retrieval");

    expect(results.map((result) => result.doc.file)).toEqual([
      "gamma.md", // 0.5*0.5 + 0.2*1 + 0.3*1 = 0.75
      "beta.md", //  0.5*1   + 0.2*1 + 0.3*0 = 0.70
      "alpha.md", // 0.5*0   + 0.2*0 + 0.3*1 = 0.30
    ]);
    for (const result of results) {
      expect(result.scores.bm25).not.toBeNull();
      expect(result.scores.keyword).not.toBeNull();
      expect(result.scores.embedding).not.toBeNull();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it("flips the ranking when the signal weights flip", async () => {
    const bm25Only = await searchDocs("retrieval", {
      weights: { bm25: 1, keyword: 0, embedding: 0 },
      relevanceThreshold: 0,
    });
    expect(bm25Only.map((result) => result.doc.file)).toEqual([
      "beta.md",
      "gamma.md",
      "alpha.md",
    ]);

    const embeddingOnly = await searchDocs("retrieval", {
      weights: { bm25: 0, keyword: 0, embedding: 1 },
      relevanceThreshold: 0,
    });
    expect(embeddingOnly.map((result) => result.doc.file)).toEqual([
      "alpha.md",
      "gamma.md",
      "beta.md",
    ]);
  });

  it("applies the relevance threshold independently of the result cap", async () => {
    // Threshold removes below-threshold docs while the cap (5) would allow
    // all three: threshold and cap are separate controls.
    const thresholded = await searchDocs("retrieval", {
      relevanceThreshold: 0.7,
    });
    expect(thresholded.map((result) => result.doc.file)).toEqual([
      "gamma.md",
      "beta.md",
    ]);

    // Cap truncates the surviving list regardless of the threshold.
    const capped = await searchDocs("retrieval", { limit: 1 });
    expect(capped).toHaveLength(1);
    expect(capped[0].doc.file).toBe("gamma.md");

    const uncappedButFiltered = await searchDocs("retrieval", {
      limit: 10,
      relevanceThreshold: 0.75,
    });
    expect(uncappedButFiltered.map((result) => result.doc.file)).toEqual([
      "gamma.md",
    ]);
  });
});

describe("bounded Jev stage (real docs-jev over a mocked getJevDecision)", () => {
  beforeEach(() => {
    seedRetrievalDocs();
  });

  it("never calls Jev when the stage is disabled (default)", async () => {
    const results = await searchDocs("retrieval");

    expect(state.jevCalls).toHaveLength(0);
    for (const result of results) {
      expect(result.jev.applied).toBe(false);
      expect(result.jev.source).toBe("disabled");
      expect(result.score).toBeCloseTo(result.jev.hybridScore, 10);
    }
  });

  it("evaluates exactly the top candidateLimit docs once, with the configured timeout, and refines their scores", async () => {
    state.settings = {
      embeddingModel: "model-a",
      decisionApiKey: "test-key",
      docsJevEnabled: true,
      docsJevCandidateLimit: 2,
      docsJevWeight: 0.4,
      docsJevTimeoutMs: 777,
    };
    state.jevImpl = () => ({
      answers: { doc_relevance: { probabilities: { "1": 0.2, "2": 0.9 } } },
    });

    const results = await searchDocs("retrieval", { relevanceThreshold: 0 });

    // Exactly ONE call, bounded to 2 candidates, with the configured timeout.
    expect(state.jevCalls).toHaveLength(1);
    const call = state.jevCalls[0];
    expect(call.timeoutMs).toBe(777);
    const questions = call.questions as {
      doc_relevance: { criteria: Record<string, string> };
    };
    expect(Object.keys(questions.doc_relevance.criteria)).toHaveLength(2);
    // Compact state: id/title/description only — the third candidate and
    // any body text never reach Jev.
    expect(String(call.state)).not.toContain("Alpha");
    expect(String(call.state)).toContain("Query: retrieval");

    // Hybrid order was gamma(0.75), beta(0.70), alpha(0.30): options 1/2
    // are gamma/beta; alpha stays outside the bound.
    const byFile = new Map(results.map((r) => [r.doc.file, r]));
    const beta = byFile.get("beta.md")!;
    const gamma = byFile.get("gamma.md")!;
    const alpha = byFile.get("alpha.md")!;

    expect(beta.jev.applied).toBe(true);
    expect(beta.jev.probability).toBeCloseTo(0.9, 10);
    expect(beta.score).toBeCloseTo(0.6 * 0.7 + 0.4 * 0.9, 10);

    expect(gamma.jev.applied).toBe(true);
    expect(gamma.jev.probability).toBeCloseTo(0.2, 10);
    expect(gamma.score).toBeCloseTo(0.6 * 0.75 + 0.4 * 0.2, 10);

    expect(alpha.jev.applied).toBe(false);
    expect(alpha.jev.source).toBe("not-evaluated");
    expect(alpha.score).toBeCloseTo(alpha.jev.hybridScore, 10);

    // Re-ranked by the final score after refinement: beta overtakes gamma.
    expect(results.map((r) => r.doc.file)).toEqual([
      "beta.md",
      "gamma.md",
      "alpha.md",
    ]);
  });

  it("thresholds the FINAL refined score, not the hybrid score", async () => {
    state.settings = {
      embeddingModel: "model-a",
      decisionApiKey: "test-key",
      docsJevEnabled: true,
      docsJevCandidateLimit: 2,
      docsJevWeight: 0.4,
      docsJevTimeoutMs: 777,
    };
    state.jevImpl = () => ({
      answers: { doc_relevance: { probabilities: { "1": 0.2, "2": 0.9 } } },
    });

    // gamma's hybrid score (0.75) clears 0.6, but its Jev-refined final
    // score (0.53) does not — only beta (final 0.78) survives.
    const results = await searchDocs("retrieval", {
      relevanceThreshold: 0.6,
    });
    expect(results.map((result) => result.doc.file)).toEqual(["beta.md"]);
    expect(results[0].score).toBeCloseTo(0.78, 10);
    expect(results[0].jev.hybridScore).toBeCloseTo(0.7, 10);
  });

  it("falls back deterministically to the hybrid score on Jev timeout", async () => {
    state.settings = {
      embeddingModel: "model-a",
      decisionApiKey: "test-key",
      docsJevEnabled: true,
      docsJevCandidateLimit: 2,
      docsJevWeight: 0.4,
      docsJevTimeoutMs: 777,
    };
    state.jevImpl = () => {
      const error = new Error("The operation timed out.");
      error.name = "TimeoutError";
      throw error;
    };

    const results = await searchDocs("retrieval", {
      relevanceThreshold: 0.6,
    });

    // One bounded attempt happened, then every score stayed hybrid:
    // threshold on the unchanged hybrid keeps gamma (0.75) and beta (0.70).
    expect(state.jevCalls).toHaveLength(1);
    expect(results.map((result) => result.doc.file)).toEqual([
      "gamma.md",
      "beta.md",
    ]);
    for (const result of results) {
      expect(result.jev.applied).toBe(false);
      expect(result.jev.source).toBe("timeout");
      expect(result.jev.probability).toBeNull();
      expect(result.score).toBeCloseTo(result.jev.hybridScore, 10);
    }
  });
});

describe("metadata-only prompt and agent-invoked linked read", () => {
  beforeEach(() => {
    seedDoc(
      "hub.md",
      "hub",
      "Hub",
      "Hub doc linking to a guide.",
      ["hub", "guide"],
      [
        "Hub SECRET body.",
        "See [the guide](guides/guide.md) for details.",
      ].join("\n"),
    );
    seedDoc(
      "guides/guide.md",
      "guide",
      "Guide",
      "Nested guide.",
      ["guide"],
      "GUIDE-SECRET nested body.",
    );
  });

  it("injects only capped references with approved metadata — never bodies", async () => {
    const prompt = await buildDocsContextPrompt("hub");

    expect(prompt).toContain('file: "hub.md"');
    expect(prompt).toContain("id: hub");
    expect(prompt).toContain("title: Hub");
    expect(prompt).toContain("description: Hub doc linking to a guide.");
    expect(prompt).toContain("keywords: hub, guide");
    expect(prompt).toContain("read_knowledge_doc");
    // No body, no snippet, no linked document, no scores.
    expect(prompt).not.toContain("SECRET");
    expect(prompt).not.toContain("guides/guide.md");
    expect(prompt).not.toMatch(/score|bm25|embedding/i);
  });

  it("lets the agent follow a descriptive link explicitly with read_knowledge_doc", async () => {
    const guide = await readDocTool.invoke({
      fileName: "guides/guide.md",
      currentDoc: "hub.md",
    });

    expect(guide).toContain('Knowledge document "guides/guide.md"');
    expect(guide).toContain("GUIDE-SECRET nested body.");

    // Exactly ONE file read for that call — the link was never crawled.
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const reads = (readTextFile as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(reads).toEqual(["docs/guides/guide.md"]);
  });
});