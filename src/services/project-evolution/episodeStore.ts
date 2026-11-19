// Persists completed world-model episodes (full request/response pairs from
// handActionToWorldModel) in one application-global SQLite database:
// <AppData>/evolution/world-episodes.db.
//
// Storage is always global: project paths are kept as row metadata, never
// used to pick the storage location. Each agent run groups its rows under
// one runId, and every buffered tool step is stored as one row with its
// step number so the "next tool" relation can be derived from
// (run_id, step) at read time.

import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, mkdir } from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";

export const EPISODE_DATABASE_DIRECTORY = "evolution";
export const EPISODE_DATABASE_FILE = "world-episodes.db";

/** Hard cap for stored tool results so the database cannot balloon. */
export const EPISODE_RESULT_LIMIT = 8 * 1024;

export type EpisodeRecord = {
  runId: string;
  project?: string;
  step: number;
  callId: string;
  tool: string;
  args?: Record<string, unknown>;
  ok: boolean;
  result?: string;
  error?: string;
};

const TRUNCATION_MARKER = "\n[...truncated by episodeStore]";
/** Leave room for the marker when truncating. */
const TRUNCATED_BODY_LIMIT = EPISODE_RESULT_LIMIT - TRUNCATION_MARKER.length;

let databasePromise: Promise<Database> | null = null;

export const episodeDatabaseUrl = async (): Promise<string> => {
  const dataDir = await appDataDir();
  const path = await join(dataDir, EPISODE_DATABASE_DIRECTORY, EPISODE_DATABASE_FILE);
  return `sqlite:${path.replace(/\\/g, "/")}`;
};

const connectEpisodeDatabase = async (): Promise<Database> => {
  await mkdir(EPISODE_DATABASE_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
  const database = await Database.load(await episodeDatabaseUrl());
  await database.execute(`
    CREATE TABLE IF NOT EXISTS world_episodes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      TEXT NOT NULL,
      project     TEXT,
      step        INTEGER NOT NULL,
      call_id     TEXT NOT NULL,
      tool        TEXT NOT NULL,
      args_json   TEXT,
      ok          INTEGER NOT NULL,
      result_text TEXT,
      error       TEXT,
      created_at  INTEGER NOT NULL
    )
  `);
  // A provider call id is only unique within one run; the same id in a later run
  // must not make a genuinely new global episode disappear.
  await database.execute("DROP INDEX IF EXISTS idx_world_episodes_call_id");
  await database.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_world_episodes_run_call ON world_episodes(run_id, call_id)");
  await database.execute("CREATE INDEX IF NOT EXISTS idx_world_episodes_run ON world_episodes(run_id, step)");
  await database.execute("DROP INDEX IF EXISTS idx_world_episodes_tool");
  await database.execute("CREATE INDEX idx_world_episodes_tool ON world_episodes(tool, created_at)");
  await database.select("SELECT 1");
  return database;
};

const getEpisodeDatabase = async (): Promise<Database> => {
  if (!databasePromise) {
    const pending = connectEpisodeDatabase();
    databasePromise = pending;
    void pending.catch(() => {
      if (databasePromise === pending) databasePromise = null;
    });
  }
  return databasePromise;
};

/** Cap oversized tool results; keep the head plus an explicit truncation marker. */
export const clampEpisodeResult = (result: string | undefined): { text?: string } => {
  if (result === undefined) return {};
  if (result.length <= EPISODE_RESULT_LIMIT) return { text: result };
  return { text: `${result.slice(0, TRUNCATED_BODY_LIMIT)}${TRUNCATION_MARKER}` };
};

export type SaveEpisodesResult = {
  saved: number;
  skipped: number;
  error?: string;
};

/**
 * Save every completed episode of a run. Rows whose callId was already
 * stored are skipped (UNIQUE index) instead of duplicated, so a retried
 * flush after a partial failure stays idempotent.
 */
export const saveEpisodeRecords = async (episodes: readonly EpisodeRecord[]): Promise<SaveEpisodesResult> => {
  if (episodes.length === 0) return { saved: 0, skipped: 0 };
  const database = await getEpisodeDatabase();
  let saved = 0;
  let skipped = 0;
  const now = Date.now();
  for (const episode of episodes) {
    const { text } = clampEpisodeResult(episode.result);
    const result = await database.execute(
      `INSERT OR IGNORE INTO world_episodes
        (run_id, project, step, call_id, tool, args_json, ok, result_text, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        episode.runId,
        episode.project ?? null,
        episode.step,
        episode.callId,
        episode.tool,
        episode.args === undefined ? null : JSON.stringify(episode.args),
        episode.ok ? 1 : 0,
        text ?? null,
        episode.error ?? null,
        now,
      ],
    );
    if (result.rowsAffected > 0) {
      saved += 1;
    } else {
      skipped += 1;
    }
  }
  return { saved, skipped };
};

export type StoredEpisodeRow = EpisodeRecord & {
  id: number;
  createdAt: number;
};

type RawEpisodeRow = {
  id: number;
  run_id: string;
  project: string | null;
  step: number;
  call_id: string;
  tool: string;
  args_json: string | null;
  ok: number;
  result_text: string | null;
  error: string | null;
  created_at: number;
};

const mapStoredRow = (row: RawEpisodeRow): StoredEpisodeRow => ({
  id: row.id,
  runId: row.run_id,
  ...(row.project ? { project: row.project } : {}),
  step: row.step,
  callId: row.call_id,
  tool: row.tool,
  ...(row.args_json ? { args: JSON.parse(row.args_json) as Record<string, unknown> } : {}),
  ok: row.ok === 1,
  ...(row.result_text ? { result: row.result_text } : {}),
  ...(row.error ? { error: row.error } : {}),
  createdAt: row.created_at,
});

export const listRunEpisodes = async (runId: string): Promise<StoredEpisodeRow[]> => {
  const database = await getEpisodeDatabase();
  const rows = await database.select<RawEpisodeRow[]>(
    "SELECT id, run_id, project, step, call_id, tool, args_json, ok, result_text, error, created_at FROM world_episodes WHERE run_id = ? ORDER BY step, id",
    [runId],
  );
  return rows.map(mapStoredRow);
};

/** Read matching tool episodes from the application-global store across all projects. */
export const listToolEpisodes = async (options: { tool: string; limit?: number }): Promise<StoredEpisodeRow[]> => {
  const database = await getEpisodeDatabase();
  let sql = "SELECT id, run_id, project, step, call_id, tool, args_json, ok, result_text, error, created_at FROM world_episodes WHERE tool = ? ORDER BY created_at DESC, id DESC";
  const params: unknown[] = [options.tool];
  if (typeof options.limit === "number" && Number.isFinite(options.limit) && options.limit > 0) {
    sql += " LIMIT ?";
    params.push(Math.floor(options.limit));
  }
  const rows = await database.select<RawEpisodeRow[]>(sql, params);
  return rows.map(mapStoredRow);
};

/** Test-only hook: reset the cached connection promise without closing Tauri's shared pool. */
export const resetEpisodeDatabaseCacheForTests = (): void => {
  databasePromise = null;
};


