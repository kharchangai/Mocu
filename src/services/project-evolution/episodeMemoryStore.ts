import { appDataDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, mkdir } from "@tauri-apps/plugin-fs";
import Database from "@tauri-apps/plugin-sql";

export const EPISODE_MEMORY_DATABASE_DIRECTORY = "evolution";
export const EPISODE_MEMORY_DATABASE_FILE = "episode-guidance.db";
export const EPISODE_MEMORY_TEXT_LIMIT = 8 * 1024;

export type EpisodeMemoryAction = {
  step: number;
  tool: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  result?: string;
  error?: string;
};

export type EpisodeMemoryLessonInput = {
  runId: string;
  causes: EpisodeMemoryAction[];
  failure: EpisodeMemoryAction;
  instruction: string;
};

export type EpisodeMemoryLesson = EpisodeMemoryLessonInput & {
  id: number;
  score: number;
  successCount: number;
  failureCount: number;
  createdAt: number;
  updatedAt: number;
};

export type EpisodeMemoryOutcome = "prevented" | "repeated";

let databasePromise: Promise<Database> | null = null;

export const episodeMemoryDatabaseUrl = async (): Promise<string> => {
  const dataDir = await appDataDir();
  const path = await join(dataDir, EPISODE_MEMORY_DATABASE_DIRECTORY, EPISODE_MEMORY_DATABASE_FILE);
  return `sqlite:${path.replace(/\\/g, "/")}`;
};

const connectDatabase = async (): Promise<Database> => {
  await mkdir(EPISODE_MEMORY_DATABASE_DIRECTORY, { baseDir: BaseDirectory.AppData, recursive: true });
  const database = await Database.load(await episodeMemoryDatabaseUrl());
  await database.execute(`
    CREATE TABLE IF NOT EXISTS episode_memory_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      causes_json TEXT NOT NULL,
      failure_json TEXT NOT NULL,
      instruction TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 50,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await database.execute("CREATE INDEX IF NOT EXISTS idx_episode_memory_updated ON episode_memory_lessons(updated_at DESC)");
  await database.select("SELECT 1");
  return database;
};

const getDatabase = async (): Promise<Database> => {
  if (!databasePromise) {
    const pending = connectDatabase();
    databasePromise = pending;
    void pending.catch(() => {
      if (databasePromise === pending) databasePromise = null;
    });
  }
  return databasePromise;
};

const clipText = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length <= EPISODE_MEMORY_TEXT_LIMIT) return value;
  return `${value.slice(0, EPISODE_MEMORY_TEXT_LIMIT - 24)}\n[...truncated]`;
};

const normalizeAction = (action: EpisodeMemoryAction): EpisodeMemoryAction => ({
  ...action,
  ...(action.result === undefined ? {} : { result: clipText(action.result) }),
  ...(action.error === undefined ? {} : { error: clipText(action.error) }),
});

export type RawEpisodeMemoryLesson = {
  id: number;
  run_id: string;
  causes_json: string;
  failure_json: string;
  instruction: string;
  score: number;
  success_count: number;
  failure_count: number;
  created_at: number;
  updated_at: number;
};

const mapLesson = (row: RawEpisodeMemoryLesson): EpisodeMemoryLesson => ({
  id: row.id,
  runId: row.run_id,
  causes: JSON.parse(row.causes_json) as EpisodeMemoryAction[],
  failure: JSON.parse(row.failure_json) as EpisodeMemoryAction,
  instruction: row.instruction,
  score: row.score,
  successCount: row.success_count,
  failureCount: row.failure_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const saveEpisodeMemoryLesson = async (
  input: EpisodeMemoryLessonInput,
): Promise<EpisodeMemoryLesson> => {
  const database = await getDatabase();
  const now = Date.now();
  const instruction = clipText(input.instruction.trim()) ?? "";
  if (!instruction) throw new Error("Cannot save an empty episode-memory instruction.");
  const causeActions = input.causes.map(normalizeAction);
  const failedAction = normalizeAction(input.failure);
  const result = await database.execute(
    `INSERT INTO episode_memory_lessons
      (run_id, causes_json, failure_json, instruction, score, success_count, failure_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, 50, 0, 0, ?, ?)`,
    [input.runId, JSON.stringify(causeActions), JSON.stringify(failedAction), instruction, now, now],
  );
  const rows = await database.select<RawEpisodeMemoryLesson[]>(
    "SELECT id, run_id, causes_json, failure_json, instruction, score, success_count, failure_count, created_at, updated_at FROM episode_memory_lessons WHERE id = ?",
    [result.lastInsertId],
  );
  if (!rows[0]) throw new Error("Saved episode-memory lesson could not be read back.");
  return mapLesson(rows[0]);
};

export const listEpisodeMemoryLessons = async (options: { limit?: number } = {}): Promise<EpisodeMemoryLesson[]> => {
  const database = await getDatabase();
  const limit = Math.max(1, Math.min(5000, Math.floor(options.limit ?? 1000)));
  const rows = await database.select<RawEpisodeMemoryLesson[]>(
    "SELECT id, run_id, causes_json, failure_json, instruction, score, success_count, failure_count, created_at, updated_at FROM episode_memory_lessons ORDER BY updated_at DESC, id DESC LIMIT ?",
    [limit],
  );
  return rows.map(mapLesson);
};

export const getEpisodeMemoryLesson = async (id: number): Promise<EpisodeMemoryLesson | null> => {
  const database = await getDatabase();
  const rows = await database.select<RawEpisodeMemoryLesson[]>(
    "SELECT id, run_id, causes_json, failure_json, instruction, score, success_count, failure_count, created_at, updated_at FROM episode_memory_lessons WHERE id = ?",
    [id],
  );
  return rows[0] ? mapLesson(rows[0]) : null;
};

/** Reward proven useful guidance and penalize guidance followed by a repeat failure. */
export const updateEpisodeMemoryScore = async (
  id: number,
  outcome: EpisodeMemoryOutcome,
): Promise<boolean> => {
  const database = await getDatabase();
  const now = Date.now();
  const delta = outcome === "prevented" ? 5 : -5;
  const countColumn = outcome === "prevented" ? "success_count" : "failure_count";
  const result = await database.execute(
    `UPDATE episode_memory_lessons
       SET score = MIN(100, MAX(0, score + ?)),
           ${countColumn} = ${countColumn} + 1,
           updated_at = ?
     WHERE id = ?`,
    [delta, now, id],
  );
  return result.rowsAffected > 0;
};

export const resetEpisodeMemoryDatabaseCacheForTests = (): void => {
  databasePromise = null;
};
