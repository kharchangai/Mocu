import { readSettings } from "../../store";
import type { DocFrontmatter } from "./doc-frontmatter";
import {
  ensureDocsIndexSchema,
  invalidateDocsIndexSchema,
  resetDocsIndexDatabaseState,
} from "./docs-index-db";
import { readAllDocsWithRaw } from "./doc-storage";

/**
 * SQLite catalog of the global Markdown docs.
 *
 * The Markdown files under BaseDirectory.AppData/docs remain canonical;
 * this module keeps a recoverable index next to them (AppData/docs/docs.db)
 * with, per document:
 *   - id + canonical relative path (file name inside the docs folder)
 *   - searchable text (title/description/keywords/body) + FTS5 BM25 mirrors
 *   - SHA-256 content hash of the raw file content
 *   - exactly one embedding, its dimensions, and the model that produced it
 *
 * Synchronization:
 *   - save/overwrite go through `syncDocIndexAfterWrite` (doc-storage hooks)
 *   - delete goes through `removeDocFromIndex`
 *   - identity/path changes and any missed operation are healed by
 *     `reconcileDocsIndex`, which re-reads the files and clears stale rows
 *   - `rebuildDocsIndex` drops and recreates the index from Markdown only
 *
 * Failure policy: Markdown content is never lost here. Every operation
 * degrades to a warning + reconcile attempt when the database or the
 * embedding provider is unavailable; lexical fields are always written so
 * BM25/keyword search works even without a vector.
 */

export type DocIndexRow = {
  id: string;
  /** Canonical relative path: file name inside the global docs folder. */
  path: string;
  title: string;
  description: string;
  keywords: string[];
  searchText: string;
  /** SHA-256 (hex) of the raw markdown file content. */
  contentHash: string;
  embedding: number[] | null;
  embeddingDim: number | null;
  embeddingModel: string | null;
  embeddedAt: number | null;
  updatedAt: number;
};

export type ReconcileReport = {
  /** Documents found in the global docs folder. */
  total: number;
  /** Rows created for documents that were not indexed yet. */
  created: number;
  /** Existing rows refreshed (content and/or metadata changed). */
  updated: number;
  /** Rows whose embedding was reused unchanged (hash + model match). */
  reusedEmbeddings: number;
  /** Rows that got a freshly computed embedding this run. */
  embedded: number;
  /** Rows kept without an embedding because the provider failed. */
  embeddingFailures: number;
  /** Stale rows removed (their file no longer exists). */
  removed: number;
};

type DocEntry = {
  file: string;
  meta: DocFrontmatter;
  body: string;
  raw: string;
};

type UpsertOutcome = {
  created: boolean;
  reusedEmbedding: boolean;
  embedded: boolean;
  embeddingFailed: boolean;
};

type RawIndexRow = {
  id: string;
  path: string;
  title: string;
  description: string;
  keywords: string;
  search_text: string;
  content_hash: string;
  embedding: string | null;
  embedding_dim: number | null;
  embedding_model: string | null;
  embedded_at: number | null;
  updated_at: number;
};

const INDEX_COLUMNS = `id, path, title, description, keywords, search_text, content_hash, embedding, embedding_dim, embedding_model, embedded_at, updated_at`;

const UPSERT_SQL = `
  INSERT INTO docs_index (
    id, path, title, description, keywords, search_text,
    content_hash, embedding, embedding_dim, embedding_model,
    embedded_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    path = excluded.path,
    title = excluded.title,
    description = excluded.description,
    keywords = excluded.keywords,
    search_text = excluded.search_text,
    content_hash = excluded.content_hash,
    embedding = excluded.embedding,
    embedding_dim = excluded.embedding_dim,
    embedding_model = excluded.embedding_model,
    embedded_at = excluded.embedded_at,
    updated_at = excluded.updated_at
`;

let initialReconcile: Promise<ReconcileReport> | null = null;
let reconcileInFlight: Promise<ReconcileReport> | null = null;
let lastWarnedContext = "";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                             */
/* -------------------------------------------------------------------------- */

function warnIndex(context: string, error: unknown): void {
  // Dedupe on the context alone so a broken database or provider cannot
  // flood the log with one identical warning per document/operation.
  if (context === lastWarnedContext) {
    return;
  }
  lastWarnedContext = context;

  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[mocu docs index] ${context}: ${detail}`);
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildSearchText(meta: DocFrontmatter, body: string): string {
  return [meta.title, meta.description, meta.keywords.join(" "), body]
    .filter((part) => part.trim().length > 0)
    .join("\n");
}

function buildEmbeddingText(meta: DocFrontmatter, body: string): string {
  // One stable whole-document embedding: the same deterministic string for
  // the same content, so re-embedding is only needed when the content or
  // the configured model changes. `textSimilarity.embedText` applies the
  // shared truncation budget internally.
  return [meta.title, meta.description, meta.keywords.join(", "), body]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

/** Current configured embedding model ("" when unset/unreadable). */
async function getCurrentEmbeddingModel(): Promise<string> {
  try {
    const settings = await readSettings();
    return (settings.embeddingModel || "").trim();
  } catch {
    return "";
  }
}

async function embedDocument(
  meta: DocFrontmatter,
  body: string,
): Promise<number[]> {
  // Dynamic import keeps the heavy langchain provider out of the module
  // graph of doc-storage/doc-generator until an embedding is actually needed.
  const { textSimilarity } = await import(
    "../../services/ai/tools/textSimilarity"
  );
  return textSimilarity.embedText(buildEmbeddingText(meta, body));
}

function parseKeywords(value: unknown): string[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  } catch {
    // fall through
  }
  return [];
}

function parseEmbedding(value: unknown): number[] | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(Number);
    }
  } catch {
    // fall through
  }
  return null;
}

function toIndexRow(raw: RawIndexRow): DocIndexRow {
  return {
    id: raw.id,
    path: raw.path,
    title: raw.title,
    description: raw.description,
    keywords: parseKeywords(raw.keywords),
    searchText: raw.search_text,
    contentHash: raw.content_hash,
    embedding: parseEmbedding(raw.embedding),
    embeddingDim: raw.embedding_dim,
    embeddingModel: raw.embedding_model,
    embeddedAt: raw.embedded_at,
    updatedAt: raw.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* SQL access                                                                */
/* -------------------------------------------------------------------------- */

async function fetchRowById(id: string): Promise<DocIndexRow | null> {
  const database = await ensureDocsIndexSchema();
  const rows = await database.select<RawIndexRow[]>(
    `SELECT ${INDEX_COLUMNS} FROM docs_index WHERE id = ?`,
    [id],
  );
  const row = rows?.[0];
  return row ? toIndexRow(row) : null;
}

async function listIndexRows(): Promise<DocIndexRow[]> {
  const database = await ensureDocsIndexSchema();
  const rows = await database.select<RawIndexRow[]>(
    `SELECT ${INDEX_COLUMNS} FROM docs_index`,
  );
  return (rows ?? []).map(toIndexRow);
}

/**
 * Writes one row. When the id already exists the row is updated in place
 * (one embedding per document); a different row claiming the same path
 * (identity/path change) is cleared first so `path` stays unique.
 */
async function upsertRow(
  entry: DocEntry,
  hash: string,
  embedding: number[] | null,
  embeddingModel: string | null,
  embeddedAt: number | null,
): Promise<void> {
  const database = await ensureDocsIndexSchema();

  await database.execute("DELETE FROM docs_index WHERE path = ? AND id != ?", [
    entry.file,
    entry.meta.id,
  ]);

  await database.execute(UPSERT_SQL, [
    entry.meta.id,
    entry.file,
    entry.meta.title,
    entry.meta.description,
    JSON.stringify(entry.meta.keywords),
    buildSearchText(entry.meta, entry.body),
    hash,
    embedding ? JSON.stringify(embedding) : null,
    embedding ? embedding.length : null,
    embeddingModel,
    embeddedAt,
    Date.now(),
  ]);
}

async function deleteRowById(id: string): Promise<void> {
  const database = await ensureDocsIndexSchema();
  await database.execute("DELETE FROM docs_index WHERE id = ?", [id]);
}

/* -------------------------------------------------------------------------- */
/* Core upsert with embedding reuse                                          */
/* -------------------------------------------------------------------------- */

async function upsertEntry(
  entry: DocEntry,
  existing: DocIndexRow | null | undefined = undefined,
  embeddingHint: DocIndexRow | null = null,
): Promise<UpsertOutcome> {
  const hash = await sha256Hex(entry.raw);
  const row =
    existing === undefined ? await fetchRowById(entry.meta.id) : existing;

  // The embedding may be reused from the live row or, right after a
  // rebuild dropped the table, from a pre-rebuild snapshot row.
  const reuseSource = row ?? embeddingHint;

  const model = await getCurrentEmbeddingModel();

  let embedding: number[] | null = reuseSource?.embedding ?? null;
  let embeddingModel: string | null = reuseSource?.embeddingModel ?? null;
  let embeddedAt: number | null = reuseSource?.embeddedAt ?? null;

  const contentUnchanged = reuseSource?.contentHash === hash;
  const reusable =
    contentUnchanged &&
    embedding !== null &&
    model !== "" &&
    embeddingModel === model;

  let embedded = false;
  let embeddingFailed = false;

  if (reusable) {
    // Hash + model unchanged: keep the stored embedding untouched.
  } else if (model === "") {
    // Provider not configured: drop stale vectors but never the content.
    embedding = null;
    embeddingModel = null;
    embeddedAt = null;
  } else {
    try {
      const vector = await embedDocument(entry.meta, entry.body);
      embedding = vector;
      embeddingModel = model;
      embeddedAt = Date.now();
      embedded = true;
    } catch (error) {
      // Embedding failure must not lose content or lexical search:
      // the row is still written with search_text + content hash.
      warnIndex(`embedding failed for "${entry.file}"`, error);
      embedding = null;
      embeddingModel = null;
      embeddedAt = null;
      embeddingFailed = true;
    }
  }

  await upsertRow(entry, hash, embedding, embeddingModel, embeddedAt);

  return {
    created: row === null,
    reusedEmbedding: reusable,
    embedded,
    embeddingFailed,
  };
}

/* -------------------------------------------------------------------------- */
/* Storage lifecycle hooks (called by doc-storage)                            */
/* -------------------------------------------------------------------------- */

/**
 * Indexes a document right after its markdown file was written.
 * Never throws: on any database problem it falls back to a full reconcile
 * (which rebuilds the row from the canonical file) and, if that also fails,
 * only warns — the markdown file is already safe on disk.
 */
export async function syncDocIndexAfterWrite(
  file: string,
  meta: DocFrontmatter,
  body: string,
  raw: string,
): Promise<void> {
  try {
    await upsertEntry({ file, meta, body, raw });
  } catch (error) {
    warnIndex(`index write failed for "${file}", reconciling`, error);
    try {
      await waitForReconcileThenRerun();
    } catch (reconcileError) {
      warnIndex("reconcile after failed index write failed", reconcileError);
    }
  }
}

/**
 * Removes the row for a deleted file. Never throws; falls back to a
 * reconcile (the file is already gone, so the stale row is cleared there).
 */
export async function removeDocFromIndex(file: string): Promise<void> {
  try {
    const database = await ensureDocsIndexSchema();
    await database.execute("DELETE FROM docs_index WHERE path = ?", [file]);
  } catch (error) {
    warnIndex(`index delete failed for "${file}", reconciling`, error);
    try {
      await waitForReconcileThenRerun();
    } catch (reconcileError) {
      warnIndex("reconcile after failed index delete failed", reconcileError);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reconcile / rebuild                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Waits for an already-running reconcile (which may have started before the
 * failing operation and therefore missed it), then starts a fresh one.
 */
async function waitForReconcileThenRerun(): Promise<ReconcileReport> {
  const previous = reconcileInFlight;
  if (previous) {
    try {
      await previous;
    } catch {
      // The previous run's failure is not ours to report.
    }
  }
  return reconcileDocsIndex();
}

type ReconcileOptions = {
  /**
   * Rows known before this run: stale-row cleanup + existence lookup.
   * `[]` after a rebuild (the table was dropped) so every document is
   * counted as freshly created.
   */
  knownRows?: DocIndexRow[];
  /**
   * Snapshot rows whose embeddings may be reused (content hash + model
   * match) even though their table no longer exists.
   */
  embeddingHints?: DocIndexRow[];
};

async function runReconcile(
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  await ensureDocsIndexSchema();
  const entries = await readAllDocsWithRaw();
  const rows = options.knownRows ?? (await listIndexRows());

  const report: ReconcileReport = {
    total: entries.length,
    created: 0,
    updated: 0,
    reusedEmbeddings: 0,
    embedded: 0,
    embeddingFailures: 0,
    removed: 0,
  };

  const liveIds = new Set(entries.map((stored) => stored.id));
  for (const row of rows) {
    if (!liveIds.has(row.id)) {
      await deleteRowById(row.id);
      report.removed += 1;
    }
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const hintsById = new Map(
    (options.embeddingHints ?? []).map((row) => [row.id, row]),
  );
  let entryFailures = 0;
  let firstEntryError: unknown = null;

  for (const stored of entries) {
    const entry: DocEntry = {
      file: stored.file,
      meta: {
        id: stored.id,
        title: stored.title,
        description: stored.description,
        keywords: stored.keywords,
      },
      body: stored.body,
      raw: stored.raw,
    };
    try {
      const outcome = await upsertEntry(
        entry,
        rowsById.get(stored.id) ?? null,
        hintsById.get(stored.id) ?? null,
      );
      if (outcome.created) {
        report.created += 1;
      } else {
        report.updated += 1;
      }
      if (outcome.reusedEmbedding) {
        report.reusedEmbeddings += 1;
      }
      if (outcome.embedded) {
        report.embedded += 1;
      }
      if (outcome.embeddingFailed) {
        report.embeddingFailures += 1;
      }
    } catch (error) {
      // Keep reconciling the other docs even when one row fails.
      entryFailures += 1;
      if (firstEntryError === null) {
        firstEntryError = error;
      }
    }
  }

  if (entryFailures > 0) {
    warnIndex(
      `reconcile could not index ${entryFailures} document(s)`,
      firstEntryError,
    );
  }

  return report;
}

/**
 * Full reconcile of the index against the canonical Markdown folder:
 * adds missing rows, refreshes changed content (hash/model), reuses
 * unchanged embeddings, and deletes rows whose file disappeared.
 * Concurrent calls share a single run.
 */
export function reconcileDocsIndex(
  options: ReconcileOptions = {},
): Promise<ReconcileReport> {
  if (reconcileInFlight) {
    return reconcileInFlight;
  }

  const pending = runReconcile(options).finally(() => {
    if (reconcileInFlight === pending) {
      reconcileInFlight = null;
    }
  });
  reconcileInFlight = pending;

  return pending;
}

/**
 * Drops every index table and recreates the schema from scratch, then
 * reconciles from Markdown. Embeddings from the snapshot are carried over
 * when content hash + model still match, so a rebuild does not re-embed
 * unchanged documents.
 */
export async function rebuildDocsIndex(): Promise<ReconcileReport> {
  const database = await ensureDocsIndexSchema();
  const snapshot = await listIndexRows();

  for (const trigger of ["docs_index_ai", "docs_index_ad", "docs_index_au"]) {
    try {
      await database.execute(`DROP TRIGGER IF EXISTS ${trigger}`);
    } catch {
      // Trigger may not exist (FTS unavailable) — nothing to drop.
    }
  }
  await database.execute("DROP TABLE IF EXISTS docs_fts");
  await database.execute("DROP TABLE IF EXISTS docs_index");
  invalidateDocsIndexSchema();

  return reconcileDocsIndex({ knownRows: [], embeddingHints: snapshot });
}

/**
 * One-time (per session) schema migration + full reconcile from Markdown.
 * Search callers should await this before querying the index; it is
 * memoized so later writes just upsert individually.
 */
export function ensureDocsIndex(): Promise<ReconcileReport> {
  if (!initialReconcile) {
    initialReconcile = reconcileDocsIndex().catch((error) => {
      initialReconcile = null;
      throw error;
    });
  }
  return initialReconcile;
}

/* -------------------------------------------------------------------------- */
/* Test support                                                              */
/* -------------------------------------------------------------------------- */

/** Clears cached connection/schema/reconcile state (tests only). */
export function resetDocsIndexStateForTests(): void {
  initialReconcile = null;
  reconcileInFlight = null;
  lastWarnedContext = "";
  resetDocsIndexDatabaseState();
}
