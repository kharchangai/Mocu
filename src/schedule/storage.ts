// src/schedule/storage.ts
//
// File-backed storage for schedules and agent-run logs.
//
// Layout inside AppData:
//   schedule/schedules.json  -> ScheduleItem[]
//   schedule/logs.json       -> ScheduleRunLog[]
//
// Every mutation also dispatches a window CustomEvent so the Schedule
// tab (and any other listener in the same webview) can refresh itself.

import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

import type {
  ScheduleItem,
  ScheduleRunLog,
} from './types';

export const SCHEDULES_CHANGED_EVENT = 'mocu-schedules-changed';
export const SCHEDULE_LOGS_CHANGED_EVENT = 'mocu-schedule-logs-changed';

const SCHEDULES_FILE = 'schedules.json';
const LOGS_FILE = 'logs.json';

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitWindowEvent(name: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(name));
}

async function getScheduleDir(): Promise<string> {
  const baseDir = await appDataDir();
  const dir = await join(baseDir, 'schedule');
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

async function getFilePath(file: string): Promise<string> {
  const dir = await getScheduleDir();
  return join(dir, file);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!(await exists(path))) {
    return fallback;
  }
  try {
    const raw = await readTextFile(path);
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error('[Schedule Storage] Failed to read', path, error);
    return fallback;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeTextFile(path, JSON.stringify(data, null, 2));
}

/*
 * ============================================================
 * Schedules
 * ============================================================
 */

export async function listSchedules(): Promise<ScheduleItem[]> {
  const path = await getFilePath(SCHEDULES_FILE);
  return readJson<ScheduleItem[]>(path, []);
}

export async function saveSchedules(items: ScheduleItem[]): Promise<void> {
  const path = await getFilePath(SCHEDULES_FILE);
  await writeJson(path, items);
  emitWindowEvent(SCHEDULES_CHANGED_EVENT);
}

export async function getSchedule(id: string): Promise<ScheduleItem | null> {
  const items = await listSchedules();
  return items.find((item) => item.id === id) ?? null;
}

function normalizeItem(
  item: Partial<ScheduleItem> & Pick<ScheduleItem, 'title' | 'kind' | 'time'>,
): ScheduleItem {
  return {
    id: item.id ?? generateId(),
    title: item.title.trim(),
    kind: item.kind,
    time: item.time,
    agentName: item.agentName?.trim() || undefined,
    agentInput: item.agentInput?.trim() || undefined,
    reminderText: item.reminderText?.trim() || undefined,
    recurrence: item.recurrence ?? 'none',
    status: item.status ?? 'pending',
    createdAt: item.createdAt ?? new Date().toISOString(),
    lastRunAt: item.lastRunAt,
    lastError: item.lastError,
  };
}

export async function createSchedule(
  item: Partial<ScheduleItem> & Pick<ScheduleItem, 'title' | 'kind' | 'time'>,
): Promise<ScheduleItem> {
  const items = await listSchedules();
  const normalized = normalizeItem(item);
  items.push(normalized);
  await saveSchedules(items);
  return normalized;
}

export async function updateSchedule(
  id: string,
  patch: Partial<ScheduleItem>,
): Promise<ScheduleItem | null> {
  const items = await listSchedules();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }

  const merged: ScheduleItem = {
    ...items[index],
    ...patch,
    id: items[index].id,
    createdAt: items[index].createdAt,
  };

  /*
   * Keep optional fields clean: an empty string patch removes the value.
   */
  if (patch.agentName === '') merged.agentName = undefined;
  if (patch.agentInput === '') merged.agentInput = undefined;
  if (patch.reminderText === '') merged.reminderText = undefined;

  items[index] = merged;
  await saveSchedules(items);
  return merged;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const items = await listSchedules();
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) {
    return false;
  }
  await saveSchedules(next);
  return true;
}

export async function deleteSchedulesByDate(date: string): Promise<number> {
  const items = await listSchedules();
  const next = items.filter((item) => !item.time.startsWith(date));
  const removed = items.length - next.length;
  if (removed > 0) {
    await saveSchedules(next);
  }
  return removed;
}

/*
 * ============================================================
 * Run logs (what scheduled agents did)
 * ============================================================
 */

export async function listScheduleLogs(): Promise<ScheduleRunLog[]> {
  const path = await getFilePath(LOGS_FILE);
  const logs = await readJson<ScheduleRunLog[]>(path, []);
  return logs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function saveLogs(logs: ScheduleRunLog[]): Promise<void> {
  const path = await getFilePath(LOGS_FILE);
  await writeJson(path, logs);
  emitWindowEvent(SCHEDULE_LOGS_CHANGED_EVENT);
}

export async function createScheduleLog(
  log: Omit<ScheduleRunLog, 'id'> & { id?: string },
): Promise<ScheduleRunLog> {
  const logs = await listScheduleLogs();
  const full: ScheduleRunLog = { ...log, id: log.id ?? generateId() };
  logs.unshift(full);

  /*
   * Keep the log file bounded: the newest 200 runs are retained.
   */
  await saveLogs(logs.slice(0, 200));
  return full;
}

export async function getScheduleLog(id: string): Promise<ScheduleRunLog | null> {
  const logs = await listScheduleLogs();
  return logs.find((log) => log.id === id) ?? null;
}

export async function updateScheduleLog(
  id: string,
  patch: Partial<Omit<ScheduleRunLog, 'id'>>,
): Promise<ScheduleRunLog | null> {
  const logs = await listScheduleLogs();
  const index = logs.findIndex((log) => log.id === id);
  if (index === -1) {
    return null;
  }
  logs[index] = { ...logs[index], ...patch, id: logs[index].id };
  await saveLogs(logs);
  return logs[index];
}

export async function appendScheduleLogEntries(
  id: string,
  entries: ScheduleRunLog['entries'],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const logs = await listScheduleLogs();
  const log = logs.find((item) => item.id === id);
  if (!log) {
    return;
  }
  log.entries = [...log.entries, ...entries];
  await saveLogs(logs);
}

export async function deleteScheduleLog(id: string): Promise<boolean> {
  const logs = await listScheduleLogs();
  const next = logs.filter((log) => log.id !== id);
  if (next.length === logs.length) {
    return false;
  }
  await saveLogs(next);
  return true;
}

export async function clearScheduleLogs(): Promise<void> {
  await saveLogs([]);
}
