import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir } from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";

/**
 * Kept as a local literal (same value as doc-storage's DOCS_DIRECTORY) so
 * this low-level connection module has no import edge back into the docs
 * modules that depend on it.
 */
const DOCS_DIRECTORY = "docs";

/**
 * Global docs SQLite index (catalog + BM25/FTS + one embedding per doc).
 *
 * The database file lives INSIDE the global docs directory:
 *
 *   BaseDirectory.AppData/docs/docs.db   (Windows: %APPDATA%/com.mocu.app/docs/docs.db)
 *
 * Markdown files under AppData/docs stay canonical; this DB is only a
 * recoverable index that can always be rebuilt from them.
 *
 * Connection notes (verified against tauri-plugin-sql 2.4.0):
 *  - The plugin maps the part after the first ":" of the connection string
 *    onto app_config_dir(); pushing an absolute path REPLACES that base, so
 *    an absolute `sqlite:<AppData>/docs/docs.db` URL resolves exactly where
 *    we want it on every platform.
 *  - `Database.load` keeps one pool per connection string, and `close()`
 *    (which we never call) closes ALL pools — so this module only loads and
 *    verifies its own URL and never touches shared SQL pools owned by
 *    databaseManager / entityMemoryStore / etc.
 *  - A cached instance can point at a pool closed elsewhere; every checkout
 *    therefore verifies liveness with `SELECT 1` and reconnects on failure.
 */
export const DOCS_INDEX_DB_FILE = "docs.db";

/** Highest schema version understood by this build. */
export const DOCS_INDEX_SCHEMA_VERSION = 1;

/**
 * Idempotent DDL grouped by schema version. Every statement uses
 * IF NOT EXISTS, so the whole ladder can be re-run safely on every start
 * (which also heals partially created schemas).
 */
const MIGRATIONS: ReadonlyArray<{
  version: number;
  statements: readonly string[];
}> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS docs_meta (
         key TEXT PRIMARY KEY NOT NULL,
         value TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS docs_index (
         id TEXT PRIMARY KEY NOT NULL,
         path TEXT NOT NULL UNIQUE,
         title TEXT NOT NULL,
         description TEXT NOT NULL,
         keywords TEXT NOT NULL DEFAULT '[]',
         search_text TEXT NOT NULL,
         content_hash TEXT NOT NULL,
         embedding TEXT,
         embedding_dim INTEGER,
         embedding_model TEXT,
         embedded_at INTEGER,
         updated_at INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_docs_index_path ON docs_index(path)`,
    ],
  },
];

/**
 * Optional FTS5 BM25 index over the lexical fields, maintained by triggers
 * on docs_index so every insert/update/delete (including rebuilds) stays in
 * sync automatically. FTS5 is compiled into the bundled SQLite of
 * libsqlite3-sys (verified in step 1), but creation is still guarded: if it
 * is unavailable at runtime the catalog and embeddings keep working and
 * `fts_enabled` records the degraded mode.
 */
const FTS_STATEMENTS: readonly string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, description, keywords, body)`,
  `CREATE TRIGGER IF NOT EXISTS docs_index_ai AFTER INSERT ON docs_index BEGIN
     INSERT INTO docs_fts(rowid, title, description, keywords, body)
     VALUES (new.rowid, new.title, new.description, new.keywords, new.search_text);
   END`,
  `CREATE TRIGGER IF NOT EXISTS docs_index_ad AFTER DELETE ON docs_index BEGIN
     DELETE FROM docs_fts WHERE rowid = old.rowid;
   END`,
  `CREATE TRIGGER IF NOT EXISTS docs_index_au AFTER UPDATE ON docs_index BEGIN
     DELETE FROM docs_fts WHERE rowid = old.rowid;
     INSERT INTO docs_fts(rowid, title, description, keywords, body)
     VALUES (new.rowid, new.title, new.description, new.keywords, new.search_text);
   END`,
];

let databasePromise: Promise<Database> | null = null;
let schemaDatabase: Database | null = null;

/** Absolute connection URL for the global docs index DB. */
export async function docsIndexDatabaseUrl(): Promise<string> {
  const dataDir = await appDataDir();
  const dbPath = await join(dataDir, DOCS_DIRECTORY, DOCS_INDEX_DB_FILE);
  return `sqlite:${dbPath.replace(/\\/g, "/")}`;
}

async function ensureDocsDirectoryExists(): Promise<void> {
  const directoryExists = await exists(DOCS_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  if (!directoryExists) {
    await mkdir(DOCS_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
  }
}

async function connect(): Promise<Database> {
  await ensureDocsDirectoryExists();

  const url = await docsIndexDatabaseUrl();
  const database = await Database.load(url);

  // Verify the pool actually answers before handing it out.
  await database.select("SELECT 1");

  return database;
}

/**
 * Returns the docs index database, lazily connecting and transparently
 * reconnecting when the cached pool is dead (e.g. closed elsewhere).
 * Throws when the database is unavailable — callers treat that as
 * "index unavailable, Markdown files remain canonical".
 */
export async function getDocsDatabase(): Promise<Database> {
  if (databasePromise) {
    try {
      const database = await databasePromise;
      await database.select("SELECT 1");
      return database;
    } catch {
      databasePromise = null;
      schemaDatabase = null;
    }
  }

  const pending = connect();
  databasePromise = pending;

  try {
    return await pending;
  } catch (error) {
    if (databasePromise === pending) {
      databasePromise = null;
      schemaDatabase = null;
    }
    throw error;
  }
}

/**
 * Opens the docs index DB and applies the idempotent schema migration.
 * The migration runs once per connection; `invalidateDocsIndexSchema`
 * forces it to run again (used by rebuilds).
 */
export async function ensureDocsIndexSchema(): Promise<Database> {
  const database = await getDocsDatabase();

  if (schemaDatabase === database) {
    return database;
  }

  await runSchemaMigration(database);
  schemaDatabase = database;

  return database;
}

async function runSchemaMigration(database: Database): Promise<void> {
  for (const migration of MIGRATIONS) {
    for (const statement of migration.statements) {
      await database.execute(statement);
    }
  }

  let ftsEnabled = false;
  try {
    for (const statement of FTS_STATEMENTS) {
      await database.execute(statement);
    }
    ftsEnabled = true;
  } catch {
    // FTS5 unavailable: catalog + embeddings still work; lexical BM25 from
    // the in-memory module covers search until it is available again.
    ftsEnabled = false;
  }

  await setDocsMeta(database, "schema_version", String(DOCS_INDEX_SCHEMA_VERSION));
  await setDocsMeta(database, "fts_enabled", ftsEnabled ? "1" : "0");
}

async function setDocsMeta(
  database: Database,
  key: string,
  value: string,
): Promise<void> {
  await database.execute(
    "INSERT OR REPLACE INTO docs_meta(key, value) VALUES (?, ?)",
    [key, value],
  );
}

/** Reads a docs_meta value (schema diagnostics, fts_enabled, ...). */
export async function getDocsMeta(key: string): Promise<string | null> {
  try {
    const database = await ensureDocsIndexSchema();
    const rows = await database.select<Array<{ value: string }>>(
      "SELECT value FROM docs_meta WHERE key = ?",
      [key],
    );
    return rows?.[0]?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Forces the next `ensureDocsIndexSchema` to re-run the migration
 * (after tables were dropped by a rebuild).
 */
export function invalidateDocsIndexSchema(): void {
  schemaDatabase = null;
}

/** Clears the cached connection + schema state (tests / full reset). */
export function resetDocsIndexDatabaseState(): void {
  databasePromise = null;
  schemaDatabase = null;
}
