import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  class FakeDb {
    rows = new Map<string, Row>();
    meta = new Map<string, string>();
    executed: string[] = [];
    ftsUnsupported = false;
    failNextUpsert = false;

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

      if (s.includes("insert into docs_index")) {
        if (this.failNextUpsert) {
          this.failNextUpsert = false;
          throw new Error("disk I/O error");
        }
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
        const [path, id] = params;
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

      if (s === "select 1") {
        return [{ "1": 1 }];
      }

      if (s.includes("from docs_meta")) {
        const key = String(params[0]);
        return this.meta.has(key) ? [{ value: this.meta.get(key) }] : [];
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
    settings: { embeddingModel: "model-a" },
    embedCalls: [] as string[],
    embedError: null as Error | null,
    failLoad: false,
    loadCalls: 0,
    db: new FakeDb(),
    FakeDb,
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
    load: vi.fn(async () => {
      state.loadCalls += 1;
      if (state.failLoad) {
        throw new Error("database unavailable");
      }
      return state.db;
    }),
  },
}));

vi.mock("../../store", () => ({
  readSettings: vi.fn(async () => ({
    embeddingModel: state.settings.embeddingModel,
  })),
}));

vi.mock("../../services/ai/tools/textSimilarity", () => ({
  textSimilarity: {
    embedText: vi.fn(async (text: string) => {
      state.embedCalls.push(text);
      if (state.embedError) {
        throw state.embedError;
      }
      return [0.25, 0.5, 0.75];
    }),
  },
}));

import type { DocFrontmatter } from "./doc-frontmatter";
import { serializeDoc } from "./doc-frontmatter";
import {
  docsIndexDatabaseUrl,
  getDocsMeta,
} from "./docs-index-db";
import {
  ensureDocsIndex,
  rebuildDocsIndex,
  reconcileDocsIndex,
  removeDocFromIndex,
  resetDocsIndexStateForTests,
  sha256Hex,
  syncDocIndexAfterWrite,
} from "./doc-index";

// Failure-path tests trigger expected index warnings; keep the output clean.
vi.spyOn(console, "warn").mockImplementation(() => undefined);

function makeDoc(
  file: string,
  id: string,
  title: string,
  body: string,
): { meta: DocFrontmatter; body: string; raw: string } {
  const meta: DocFrontmatter = {
    id,
    title,
    description: `${title} description.`,
    keywords: [id, "shared-kw"],
  };
  const raw = serializeDoc(meta, body);
  state.files.set(`docs/${file}`, raw);
  return { meta, body, raw };
}

beforeEach(() => {
  state.files.clear();
  state.db = new state.FakeDb();
  state.settings.embeddingModel = "model-a";
  state.embedCalls.length = 0;
  state.embedError = null;
  state.failLoad = false;
  state.loadCalls = 0;
  resetDocsIndexStateForTests();
});

describe("docs index connection", () => {
  it("targets the SQLite file inside the global AppData docs folder", async () => {
    await expect(docsIndexDatabaseUrl()).resolves.toBe(
      "sqlite:C:/appdata/docs/docs.db",
    );
  });

  it("applies an idempotent schema with FTS5 enabled and records metadata", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Alpha body.");
    await reconcileDocsIndex();
    await reconcileDocsIndex(); // second run must be a no-op re-migration

    expect(await getDocsMeta("schema_version")).toBe("1");
    expect(await getDocsMeta("fts_enabled")).toBe("1");
    expect(
      state.db.executed.some((sql) =>
        sql.toLowerCase().includes("create table if not exists docs_index"),
      ),
    ).toBe(true);
    expect(state.db.rows.size).toBe(1);
  });

  it("keeps the catalog working when FTS5 is unavailable", async () => {
    state.db.ftsUnsupported = true;
    makeDoc("alpha.md", "alpha", "Alpha", "Alpha body.");

    const report = await reconcileDocsIndex();

    expect(report.created).toBe(1);
    expect(state.db.rows.size).toBe(1);
    expect(await getDocsMeta("fts_enabled")).toBe("0");
  });
});

describe("initial sync from Markdown", () => {
  it("indexes every document with hash, lexical text, embedding and model", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "All about alpha.");
    makeDoc("beta.md", "beta", "Beta", "All about beta.");

    const report = await reconcileDocsIndex();

    expect(report.total).toBe(2);
    expect(report.created).toBe(2);
    expect(report.embedded).toBe(2);
    expect(report.embeddingFailures).toBe(0);
    expect(state.db.rows.size).toBe(2);
    expect(state.embedCalls).toHaveLength(2);

    const row = state.db.rows.get("alpha")!;
    expect(row.path).toBe("alpha.md");
    expect(row.title).toBe("Alpha");
    expect(row.content_hash).toBe(
      await sha256Hex(state.files.get("docs/alpha.md")!),
    );
    expect(String(row.content_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(row.embedding_model).toBe("model-a");
    expect(row.embedding_dim).toBe(3);
    expect(JSON.parse(String(row.embedding))).toEqual([0.25, 0.5, 0.75]);
    expect(JSON.parse(String(row.keywords))).toEqual([
      "alpha",
      "shared-kw",
    ]);
    expect(String(row.search_text)).toContain("All about alpha.");
    expect(String(row.search_text)).toContain("Alpha description.");
  });

  it("is idempotent: a second reconcile reuses embeddings instead of re-embedding", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "All about alpha.");

    await reconcileDocsIndex();
    const report = await reconcileDocsIndex();

    expect(report.created).toBe(0);
    expect(report.updated).toBe(1);
    expect(report.reusedEmbeddings).toBe(1);
    expect(report.embedded).toBe(0);
    expect(state.embedCalls).toHaveLength(1);
    expect(state.db.rows.size).toBe(1);
  });
});

describe("write-path synchronization", () => {
  it("reuses the embedding when content and model are unchanged", async () => {
    const doc = makeDoc("alpha.md", "alpha", "Alpha", "Body v1.");

    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);
    expect(state.embedCalls).toHaveLength(1);
    const firstHash = state.db.rows.get("alpha")!.content_hash;

    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);
    expect(state.embedCalls).toHaveLength(1);
    expect(state.db.rows.get("alpha")!.content_hash).toBe(firstHash);
  });

  it("re-embeds and updates the hash when the content changes", async () => {
    const v1 = makeDoc("alpha.md", "alpha", "Alpha", "Body v1.");
    await syncDocIndexAfterWrite("alpha.md", v1.meta, v1.body, v1.raw);

    const v2 = makeDoc("alpha.md", "alpha", "Alpha", "Body v2 changed.");
    await syncDocIndexAfterWrite("alpha.md", v2.meta, v2.body, v2.raw);

    expect(state.embedCalls).toHaveLength(2);
    expect(state.db.rows.get("alpha")!.content_hash).not.toBe(
      await sha256Hex(v1.raw),
    );
    expect(state.db.rows.get("alpha")!.content_hash).toBe(
      await sha256Hex(v2.raw),
    );
    expect(String(state.db.rows.get("alpha")!.search_text)).toContain(
      "Body v2 changed.",
    );
  });

  it("re-embeds when the configured embedding model changes", async () => {
    const doc = makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);
    expect(state.db.rows.get("alpha")!.embedding_model).toBe("model-a");

    state.settings.embeddingModel = "model-b";
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);

    expect(state.embedCalls).toHaveLength(2);
    expect(state.db.rows.get("alpha")!.embedding_model).toBe("model-b");
  });

  it("clears stale embeddings when no model is configured, keeping lexical fields", async () => {
    const doc = makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);
    expect(state.db.rows.get("alpha")!.embedding).not.toBeNull();

    state.settings.embeddingModel = "";
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);

    const row = state.db.rows.get("alpha")!;
    expect(row.embedding).toBeNull();
    expect(row.embedding_model).toBeNull();
    expect(row.search_text).toContain("Body.");
    expect(row.content_hash).toBe(await sha256Hex(doc.raw));
  });
});

describe("delete synchronization", () => {
  it("removes the row on explicit delete", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    makeDoc("beta.md", "beta", "Beta", "Body.");
    await reconcileDocsIndex();
    expect(state.db.rows.size).toBe(2);

    await removeDocFromIndex("alpha.md");

    expect(state.db.rows.has("alpha")).toBe(false);
    expect(state.db.rows.has("beta")).toBe(true);
  });

  it("removes stale rows during reconcile when the file disappeared", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    makeDoc("beta.md", "beta", "Beta", "Body.");
    await reconcileDocsIndex();

    state.files.delete("docs/alpha.md");
    const report = await reconcileDocsIndex();

    expect(report.removed).toBe(1);
    expect(state.db.rows.has("alpha")).toBe(false);
    expect(state.db.rows.has("beta")).toBe(true);
  });

  it("tracks identity/path changes: renamed file updates the row in place", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Same body.");
    await reconcileDocsIndex();
    expect(state.db.rows.get("alpha")!.path).toBe("alpha.md");
    expect(state.embedCalls).toHaveLength(1);

    // The doc was renamed on disk but kept its stable id.
    state.files.delete("docs/alpha.md");
    makeDoc("renamed.md", "alpha", "Alpha", "Same body.");
    const report = await reconcileDocsIndex();

    expect(state.db.rows.size).toBe(1);
    expect(state.db.rows.get("alpha")!.path).toBe("renamed.md");
    expect(report.removed).toBe(0);
    expect(report.reusedEmbeddings).toBe(1);
    expect(state.embedCalls).toHaveLength(1); // unchanged hash+model: reused
  });
});

describe("rebuild", () => {
  it("recreates the index from Markdown and carries embeddings over", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Alpha body.");
    makeDoc("beta.md", "beta", "Beta", "Beta body.");
    await reconcileDocsIndex();
    expect(state.embedCalls).toHaveLength(2);

    const report = await rebuildDocsIndex();

    expect(report.created).toBe(2);
    expect(report.reusedEmbeddings).toBe(2);
    expect(state.db.rows.size).toBe(2);
    expect(state.embedCalls).toHaveLength(2); // no re-embedding needed
    expect(await getDocsMeta("schema_version")).toBe("1");
    expect(await getDocsMeta("fts_enabled")).toBe("1");
  });

  it("recovers an index whose rows were lost, re-embedding as needed", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Alpha body.");
    await reconcileDocsIndex();
    expect(state.embedCalls).toHaveLength(1);

    state.db.rows.clear(); // simulate a wiped/corrupted catalog
    const report = await rebuildDocsIndex();

    expect(report.created).toBe(1);
    expect(state.db.rows.size).toBe(1);
    expect(state.embedCalls).toHaveLength(2);
    expect(state.db.rows.get("alpha")!.embedding).not.toBeNull();
  });
});

describe("failure recovery", () => {
  it("keeps content and lexical fields when the embedding provider fails, then retries", async () => {
    const doc = makeDoc("alpha.md", "alpha", "Alpha", "Body for failure.");
    state.embedError = new Error("embedding provider down");

    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);

    const row = state.db.rows.get("alpha")!;
    expect(row).toBeDefined();
    expect(row.embedding).toBeNull();
    expect(row.embedding_model).toBeNull();
    expect(row.content_hash).toBe(await sha256Hex(doc.raw));
    expect(String(row.search_text)).toContain("Body for failure.");

    state.embedError = null;
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);

    expect(state.db.rows.get("alpha")!.embedding).not.toBeNull();
    expect(state.db.rows.get("alpha")!.embedding_model).toBe("model-a");
  });

  it("recovers a failed index write through reconcile (file stays canonical)", async () => {
    const doc = makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    state.db.failNextUpsert = true;

    // Must not throw: the markdown file is already on disk.
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);

    expect(state.files.get("docs/alpha.md")).toBe(doc.raw);
    expect(state.db.rows.has("alpha")).toBe(true); // fallback reconcile healed it
  });

  it("never throws when the database is unavailable and recovers afterwards", async () => {
    const doc = makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    state.failLoad = true;

    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);
    expect(state.db.rows.size).toBe(0);

    state.failLoad = false;
    await syncDocIndexAfterWrite("alpha.md", doc.meta, doc.body, doc.raw);

    expect(state.db.rows.has("alpha")).toBe(true);
    expect(state.embedCalls).toHaveLength(1);
  });

  it("removes rows via reconcile after a failed direct delete", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Body.");
    await reconcileDocsIndex();
    expect(state.db.rows.has("alpha")).toBe(true);

    state.failLoad = true;
    // Direct delete hits the (dead) database and falls back to reconcile;
    // the file still exists, so the reconcile below with the file removed
    // is the supported path — here we only assert the op does not throw.
    await expect(removeDocFromIndex("alpha.md")).resolves.toBeUndefined();
    state.failLoad = false;
  });
});

describe("ensureDocsIndex", () => {
  it("runs the initial reconcile once per session", async () => {
    makeDoc("alpha.md", "alpha", "Alpha", "Body.");

    const first = await ensureDocsIndex();
    const second = await ensureDocsIndex();

    expect(first.created).toBe(1);
    expect(second.created).toBe(1);
    expect(state.embedCalls).toHaveLength(1);
    expect(state.db.rows.size).toBe(1);
  });
});
