import { tool } from "@langchain/core/tools";
import { invoke } from "@tauri-apps/api/core";
import { dirname, join, normalize } from "@tauri-apps/api/path";
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { z } from "zod";

/**
 * Project-local, append-only history. The project's .git directory and Git
 * index are never read or modified. File bytes are stored only for changed
 * files, under .mocu/history/snapshots/<checkpoint-id>/.
 */
const MOCU_DIR = ".mocu";
const HISTORY_DIR = "history";
const SNAPSHOTS_DIR = "snapshots";
const INDEX_FILE = "index.json";
const IGNORE_FILE = ".mocuignore";
const MAX_DIFF_CELLS = 2_000_000;
const MAX_DIFF_LINES = 500;

type FileState = { hash: string; size: number; mtime?: string };
type FileChange = {
  path: string;
  kind: "file";
  status: "added" | "modified" | "deleted";
  hash?: string;
  size?: number;
};
type DirectoryChange = {
  path: string;
  kind: "directory";
  status: "added" | "deleted";
};
type HistoryCheckpoint = {
  id: string;
  runId: string | null;
  phase: "baseline" | "before" | "after";
  timestamp: string;
  changes: Array<FileChange | DirectoryChange>;
};
type HistoryRun = { id: string; startedAt: string; endedAt: string | null };
type HistoryIndex = {
  version: 1;
  projectPath: string;
  createdAt: string;
  currentFiles: Record<string, FileState>;
  currentDirectories: string[];
  checkpoints: HistoryCheckpoint[];
  runs: HistoryRun[];
};
type ScannedProject = {
  files: Map<string, FileState>;
  directories: Set<string>;
  changes: Array<FileChange | DirectoryChange>;
};
type ScannedProjectResponse = {
  files: Array<FileState & { path: string; mtime: string | null }>;
  directories: string[];
  changes: Array<FileChange | DirectoryChange>;
};
type StoredFileVersion = { hash: string; size: number; blobPath: string; checkpointId: string };

const projectLocks = new Map<string, Promise<void>>();
const joinPath = (...parts: string[]): Promise<string> => join(...parts);
async function assertNoSymlinkPath(projectPath: string, relative: string): Promise<void> {
  let current = projectPath;
  for (const segment of relative.split("/")) {
    if (!(await exists(current))) return;
    const entries = await readDir(current);
    const entry = entries.find((item) => item.name === segment);
    if (entry?.isSymlink) throw new Error(`Refusing to follow a symlink while restoring ${relative}.`);
    if (!entry) return;
    current = await joinPath(current, segment);
  }
}
const canonicalPath = (path: string): string => path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
const makeId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function globToRegex(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        i += 1;
        if (pattern[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "i");
}

type IgnoreRule = { negated: boolean; directoryOnly: boolean; hasSlash: boolean; regex: RegExp };

/** Basic Git-ignore-style matching for .mocuignore (including **, ! and directory rules). */
export function compileMocuIgnore(text: string): IgnoreRule[] {
  return text.split(/\r?\n/).flatMap((rawLine) => {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) return [];
    let negated = false;
    if (line.startsWith("!") && !line.startsWith("\\!")) {
      negated = true;
      line = line.slice(1);
    }
    line = line.replace(/\\([#!])/g, "$1");
    if (!line) return [];
    const directoryOnly = line.endsWith("/");
    line = line.replace(/^\//, "").replace(/\/$/, "");
    const hasSlash = line.includes("/");
    return [{ negated, directoryOnly, hasSlash, regex: globToRegex(line) }];
  });
}

export function isMocuIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  const path = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!path || path === ".mocu" || path.startsWith(".mocu/") || path === ".git" || path.startsWith(".git/")) return true;
  const segments = path.split("/");
  let ignored = false;
  for (const rule of rules) {
    let matched = false;
    if (rule.hasSlash) {
      matched = rule.regex.test(path) || (isDirectory && rule.regex.test(`${path}/`)) || segments.slice(0, -1).some((_, index) => {
        const parent = segments.slice(0, index + 1).join("/");
        return rule.regex.test(parent) || rule.regex.test(`${parent}/`);
      });
    } else {
      matched = segments.some((segment, index) => {
        const isMatchedDirectory = index < segments.length - 1 || isDirectory;
        return rule.regex.test(segment) && (!rule.directoryOnly || isMatchedDirectory);
      });
    }
    if (matched) ignored = !rule.negated;
  }
  return ignored;
}
async function getPaths(projectPath: string) {
  const mocuPath = await joinPath(projectPath, MOCU_DIR);
  const historyPath = await joinPath(mocuPath, HISTORY_DIR);
  return {
    mocuPath,
    ignorePath: await joinPath(mocuPath, IGNORE_FILE),
    historyPath,
    snapshotsPath: await joinPath(historyPath, SNAPSHOTS_DIR),
    indexPath: await joinPath(historyPath, INDEX_FILE),
  };
}

async function ensureProjectFiles(projectPath: string): Promise<{ index: HistoryIndex; paths: Awaited<ReturnType<typeof getPaths>> }> {
  const paths = await getPaths(projectPath);
  await mkdir(paths.mocuPath, { recursive: true });
  await mkdir(paths.snapshotsPath, { recursive: true });
  if (!(await exists(paths.ignorePath))) {
    let seeded = "";
    const gitIgnorePath = await joinPath(projectPath, ".gitignore");
    if (await exists(gitIgnorePath)) {
      try { seeded = await readTextFile(gitIgnorePath); } catch { seeded = ""; }
    }
    const header = "# Mocu project history exclusions. Seeded from the project's .gitignore when available.\n# Edit these rules independently; .mocu and .git are always excluded.\nnode_modules/\ndist/\ntarget/\nbuild/\n.mocu/\n.git/\n";
    await writeTextFile(paths.ignorePath, header + seeded);
  }
  let index: HistoryIndex;
  if (await exists(paths.indexPath)) {
    index = JSON.parse(await readTextFile(paths.indexPath)) as HistoryIndex;
    if (index.version !== 1 || !Array.isArray(index.checkpoints) || !index.currentFiles) {
      throw new Error(`Unsupported or corrupt Mocu project history index: ${paths.indexPath}`);
    }
  } else {
    index = {
      version: 1,
      projectPath,
      createdAt: new Date().toISOString(),
      currentFiles: {},
      currentDirectories: [],
      checkpoints: [],
      runs: [],
    };
  }
  return { index, paths };
}

async function scanProject(
  projectPath: string,
  rulesText: string,
  previousFiles: Record<string, FileState>,
  previousDirectories: string[],
  snapshotRoot: string,
): Promise<ScannedProject> {
  const result = await invoke<ScannedProjectResponse>("project_history_scan", {
    projectPath,
    rulesText,
    previousFiles,
    previousDirectories,
    snapshotRoot,
  });
  return {
    files: new Map(result.files.map(({ path, hash, size, mtime }) => [path, { hash, size, ...(mtime ? { mtime } : {}) }])),
    directories: new Set(result.directories),
    changes: result.changes,
  };
}

async function saveIndex(path: string, index: HistoryIndex): Promise<void> {
  await writeTextFile(path, JSON.stringify(index, null, 2));
}

async function recordCheckpoint(
  projectPath: string,
  index: HistoryIndex,
  paths: Awaited<ReturnType<typeof getPaths>>,
  phase: HistoryCheckpoint["phase"],
  runId: string | null,
): Promise<HistoryCheckpoint | null> {
  const checkpointId = makeId();
  const snapshotRoot = await joinPath(paths.snapshotsPath, checkpointId);
  const scanned = await scanProject(
    projectPath,
    await readTextFile(paths.ignorePath),
    index.currentFiles,
    index.currentDirectories,
    snapshotRoot,
  );
  index.currentFiles = Object.fromEntries(scanned.files.entries());
  index.currentDirectories = Array.from(scanned.directories).sort();
  if (!scanned.changes.length) return null;
  const checkpoint: HistoryCheckpoint = {
    id: checkpointId,
    runId,
    phase,
    timestamp: new Date().toISOString(),
    changes: scanned.changes.sort((a, b) => a.path.localeCompare(b.path)),
  };
  index.checkpoints.push(checkpoint);
  await saveIndex(paths.indexPath, index);
  return checkpoint;
}
async function initializeBaseline(
  projectPath: string,
  index: HistoryIndex,
  paths: Awaited<ReturnType<typeof getPaths>>,
): Promise<void> {
  if (index.checkpoints.length) return;
  await recordCheckpoint(projectPath, index, paths, "baseline", null);
  if (!index.checkpoints.length) {
    index.checkpoints.push({ id: makeId(), runId: null, phase: "baseline", timestamp: new Date().toISOString(), changes: [] });
    await saveIndex(paths.indexPath, index);
  }
}

async function beginUnlocked(projectPath: string): Promise<string> {
  const { index, paths } = await ensureProjectFiles(projectPath);
  await initializeBaseline(projectPath, index, paths);
  const runId = makeId();
  index.runs.push({ id: runId, startedAt: new Date().toISOString(), endedAt: null });
  await recordCheckpoint(projectPath, index, paths, "before", runId);
  await saveIndex(paths.indexPath, index);
  return runId;
}

async function finishUnlocked(projectPath: string, runId: string): Promise<void> {
  const { index, paths } = await ensureProjectFiles(projectPath);
  await recordCheckpoint(projectPath, index, paths, "after", runId);
  const run = index.runs.find((item) => item.id === runId);
  if (run) run.endedAt = new Date().toISOString();
  await saveIndex(paths.indexPath, index);
}

export async function withProjectHistorySession<T>(projectPath: string, run: () => Promise<T>): Promise<T> {
  const normalized = await normalize(projectPath);
  const key = canonicalPath(normalized);
  const previous = projectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  projectLocks.set(key, current);
  await previous;
  let runId: string | undefined;
  try {
    runId = await beginUnlocked(normalized);
    return await run();
  } finally {
    try {
      if (runId) await finishUnlocked(normalized, runId);
    } finally {
      release();
      if (projectLocks.get(key) === current) projectLocks.delete(key);
    }
  }
}

async function loadIndex(projectPath: string) {
  const { index, paths } = await ensureProjectFiles(projectPath);
  if (!index.checkpoints.length) await initializeBaseline(projectPath, index, paths);
  return { index, paths };
}

function resolveProjectRelativePath(input: string): string {
  const normalized = input.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:/i.test(normalized) || normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Use a non-empty project-relative path without '..' segments.");
  }
  if (normalized === ".mocu" || normalized.startsWith(".mocu/") || normalized === ".git" || normalized.startsWith(".git/")) {
    throw new Error("Mocu history and Git internals are not project-history targets.");
  }
  return normalized;
}

function checkpointFiles(index: HistoryIndex, throughIndex: number): Map<string, StoredFileVersion> {
  const state = new Map<string, StoredFileVersion>();
  for (let i = 0; i <= throughIndex; i += 1) {
    const checkpoint = index.checkpoints[i];
    for (const change of checkpoint.changes) {
      if (change.kind !== "file") continue;
      if (change.status === "deleted") state.delete(change.path);
      else state.set(change.path, {
        hash: change.hash!,
        size: change.size ?? 0,
        checkpointId: checkpoint.id,
        blobPath: `snapshots/${checkpoint.id}/${change.path}`,
      });
    }
  }
  return state;
}

async function readStoredVersion(paths: Awaited<ReturnType<typeof getPaths>>, version: StoredFileVersion): Promise<Uint8Array> {
  const absolute = await joinPath(paths.historyPath, ...version.blobPath.split("/"));
  return readFile(absolute);
}

function lineDiff(before: string, after: string): string[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  if (a.length * b.length > MAX_DIFF_CELLS) {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
    return [`[Large diff: ${a.length - prefix - suffix} old line(s) replaced by ${b.length - prefix - suffix} new line(s); LCS limit reached.]`, ...a.slice(prefix, a.length - suffix).map((line, i) => `- ${prefix + i + 1} | ${line}`), ...b.slice(prefix, b.length - suffix).map((line, i) => `+ ${prefix + i + 1} | ${line}`)].slice(0, MAX_DIFF_LINES);
  }
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const result: string[] = [];
  let i = 0;
  let j = 0;
  let newLine = 1;
  while ((i < a.length || j < b.length) && result.length < MAX_DIFF_LINES) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      result.push(`  ${i + 1} | ${a[i]}`); i += 1; j += 1; newLine += 1;
    } else if (i < a.length && (j >= b.length || table[(i + 1) * width + j] >= table[i * width + j + 1])) {
      result.push(`- ${i + 1} | ${a[i]}`); i += 1;
    } else {
      result.push(`+ ${newLine} | ${b[j]}`); j += 1; newLine += 1;
    }
  }
  if (i < a.length || j < b.length) result.push("[Diff output truncated]");
  return result;
}

function isLikelyText(bytes: Uint8Array): boolean {
  if (bytes.subarray(0, Math.min(bytes.length, 8192)).includes(0)) return false;
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

export async function getProjectHistory(projectPath: string, limit = 50): Promise<string> {
  const { index } = await loadIndex(await normalize(projectPath));
  const checkpoints = index.checkpoints.slice(-Math.min(Math.max(limit, 1), 100));
  return JSON.stringify({
    projectPath: index.projectPath,
    createdAt: index.createdAt,
    totalCheckpoints: index.checkpoints.length,
    checkpoints: checkpoints.map(({ id, runId, phase, timestamp, changes }) => ({ id, runId, phase, timestamp, changeCount: changes.length, changes })),
    runs: index.runs.slice(-50),
  }, null, 2);
}

export async function getProjectFileHistory(projectPath: string, input: { path: string; fromCheckpointId?: string; toCheckpointId?: string }): Promise<string> {
  const relative = resolveProjectRelativePath(input.path);
  const { index, paths } = await loadIndex(await normalize(projectPath));
  let start = input.fromCheckpointId ? index.checkpoints.findIndex((item) => item.id === input.fromCheckpointId) : 0;
  let end = input.toCheckpointId ? index.checkpoints.findIndex((item) => item.id === input.toCheckpointId) : index.checkpoints.length - 1;
  if (start < 0 || end < 0) throw new Error("Unknown checkpoint id.");
  if (start > end) throw new Error("fromCheckpointId must not be later than toCheckpointId.");
  const events = index.checkpoints.slice(start, end + 1).flatMap((checkpoint, relativeIndex) => {
    const change = checkpoint.changes.find((item) => item.kind === "file" && item.path === relative);
    return change ? [{ checkpoint, change, index: start + relativeIndex }] : [];
  });
  const details = [];
  let priorVersion = start > 0 ? checkpointFiles(index, start - 1).get(relative) : undefined;
  for (const event of events) {
    const currentState = checkpointFiles(index, event.index).get(relative);
    let diff: string[] = [];
    if (priorVersion && currentState) {
      const beforeBytes = await readStoredVersion(paths, priorVersion);
      const afterBytes = await readStoredVersion(paths, currentState);
      if (isLikelyText(beforeBytes) && isLikelyText(afterBytes)) diff = lineDiff(new TextDecoder().decode(beforeBytes), new TextDecoder().decode(afterBytes));
      else diff = [`[Binary file: ${priorVersion.size} bytes -> ${currentState.size} bytes]`];
    } else if (!currentState && priorVersion) diff = ["[File deleted]"];
    else if (currentState) {
      const bytes = await readStoredVersion(paths, currentState);
      diff = isLikelyText(bytes) ? lineDiff("", new TextDecoder().decode(bytes)) : [`[Binary file added: ${currentState.size} bytes]`];
    }
    details.push({ checkpointId: event.checkpoint.id, phase: event.checkpoint.phase, runId: event.checkpoint.runId, timestamp: event.checkpoint.timestamp, change: event.change.status, hash: event.change.kind === "file" ? event.change.hash : undefined, diff: diff.slice(0, MAX_DIFF_LINES) });
    priorVersion = currentState;
  }
  return JSON.stringify({ path: relative, from: index.checkpoints[start]?.id, to: index.checkpoints[end]?.id, changes: details }, null, 2);
}

export async function prepareProjectFileRestore(projectPath: string, input: { path: string; checkpointId: string }): Promise<{ relative: string; target?: StoredFileVersion; conflict: boolean; currentHash?: string; currentPath: string; index: HistoryIndex; paths: Awaited<ReturnType<typeof getPaths>> }> {
  const relative = resolveProjectRelativePath(input.path);
  const normalized = await normalize(projectPath);
  const { index, paths } = await loadIndex(normalized);
  const targetIndex = index.checkpoints.findIndex((item) => item.id === input.checkpointId);
  if (targetIndex < 0) throw new Error("Unknown checkpoint id.");
  const historicallyTracked = index.checkpoints.some((checkpoint) => checkpoint.changes.some((change) => change.kind === "file" && change.path === relative));
  if (!historicallyTracked) throw new Error(`File has no recorded history: ${relative}`);
  const target = checkpointFiles(index, targetIndex).get(relative);
  const currentPath = await joinPath(normalized, ...relative.split("/"));
  await assertNoSymlinkPath(normalized, relative);
  const expected = index.currentFiles[relative];
  const currentHash = await exists(currentPath) ? await sha256(await readFile(currentPath)) : undefined;
  const conflict = currentHash !== expected?.hash;
  const changedSince = index.checkpoints.slice(targetIndex + 1).some((checkpoint) =>
    checkpoint.changes.some((change) => change.kind === "file" && change.path === relative),
  );
  return { relative, target, conflict: conflict || changedSince, currentHash, currentPath, index, paths };
}
export async function applyProjectFileRestore(plan: Awaited<ReturnType<typeof prepareProjectFileRestore>>): Promise<string> {
  const { target, currentPath, relative, paths, currentHash } = plan;
  const root = await normalize(plan.index.projectPath);
  await assertNoSymlinkPath(root, relative);
  const latestHash = await exists(currentPath) ? await sha256(await readFile(currentPath)) : undefined;
  if (latestHash !== currentHash) throw new Error(`File changed after restore confirmation; no changes were made. Review ${relative} before retrying.`);
  if (target) {
    const bytes = await readStoredVersion(paths, target);
    const parent = await dirname(currentPath);
    await mkdir(parent, { recursive: true });
    await writeFile(currentPath, bytes);
    return `Restored ${relative} to checkpoint ${target.checkpointId} (${target.size} bytes).`;
  }
  if (await exists(currentPath)) {
    await remove(currentPath);
    return `Removed ${relative}; it did not exist at the selected checkpoint.`;
  }
  return `${relative} was already absent at the selected checkpoint.`;
}
export function createProjectHistoryTools(projectPath: string) {
  const history = tool(async ({ limit }) => getProjectHistory(projectPath, limit), {
    name: "project_history",
    description: "Shows the recorded project file/folder history, checkpoint IDs, timestamps, and whether each checkpoint is a baseline, pre-work/user change, or Mocu post-work change. Use this first to find checkpoint IDs.",
    schema: z.object({ limit: z.number().int().positive().max(100).optional().default(50) }),
  });
  const fileHistory = tool(async ({ path, fromCheckpointId, toCheckpointId }) =>
    getProjectFileHistory(projectPath, { path, fromCheckpointId, toCheckpointId }), {
    name: "project_file_history",
    description: "Shows the timeline and line-by-line diffs for a project-relative file, optionally bounded by checkpoint IDs. Use project_history to find IDs.",
    schema: z.object({ path: z.string().min(1), fromCheckpointId: z.string().optional(), toCheckpointId: z.string().optional() }),
  });
  const restore = tool(async ({ path, checkpointId }) =>
    JSON.stringify({ path, checkpointId, instruction: "Restore is executed by the project agent so it can ask permission when current content is ambiguous." }), {
    name: "restore_project_file",
    description: "Restores one project-relative file to the state it had at a selected checkpoint. If the current file contains unrecorded changes, the agent must ask the user before overwriting it. Use project_history to find a checkpoint ID.",
    schema: z.object({ path: z.string().min(1), checkpointId: z.string().min(1) }),
  });
  return { history, fileHistory, restore };
}





