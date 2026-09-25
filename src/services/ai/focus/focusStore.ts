import { exists, mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

import type { FocusLogEntry, FocusLogKind, FocusMemory, FocusState } from "./types";

function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Error) return { name: item.name, message: item.message };
    return item;
  }, 2) ?? "null";
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Focus data stays alongside a selected project; only the chat pointer is global. */
export class FocusStore {
  private readonly rootPromise: Promise<string>;

  constructor() {
    this.rootPromise = this.resolveRoot();
  }

  private async resolveRoot(): Promise<string> {
    const root = await join(await appDataDir(), "focus-sessions");
    if (!(await exists(root))) await mkdir(root, { recursive: true });
    const registry = await join(root, "registry");
    if (!(await exists(registry))) await mkdir(registry, { recursive: true });
    return root;
  }

  private validateId(id: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid Focus session ID.");
  }

  private async registryPath(id: string): Promise<string> {
    this.validateId(id);
    return join(await this.rootPromise, "registry", `${id}.json`);
  }

  private async readRegistry(id: string): Promise<{ chatId: string; projectPath?: string } | null> {
    const path = await this.registryPath(id);
    if (!(await exists(path))) return null;
    try {
      return JSON.parse(await readTextFile(path)) as { chatId: string; projectPath?: string };
    } catch {
      return null;
    }
  }

  private async sessionDirectory(id: string): Promise<string> {
    this.validateId(id);
    const registry = await this.readRegistry(id);
    if (registry?.projectPath?.trim()) {
      return join(registry.projectPath, ".mocu", "focus-sessions", id);
    }
    return join(await this.rootPromise, id);
  }

  private async indexPath(): Promise<string> {
    return join(await this.rootPromise, "active-index.json");
  }

  async getChatFocus(chatId: string): Promise<string | null> {
    const path = await this.indexPath();
    if (!(await exists(path))) return null;
    try {
      const index = JSON.parse(await readTextFile(path)) as Record<string, string>;
      return index[chatId] ?? null;
    } catch {
      return null;
    }
  }

  async setChatFocus(chatId: string, focusId: string | null): Promise<void> {
    const path = await this.indexPath();
    let index: Record<string, string> = {};
    if (await exists(path)) {
      try {
        index = JSON.parse(await readTextFile(path)) as Record<string, string>;
      } catch {
        index = {};
      }
    }
    if (focusId) index[chatId] = focusId;
    else delete index[chatId];
    await writeTextFile(path, toJson(index));
  }

  async save(state: FocusState): Promise<void> {
    const registryPath = await this.registryPath(state.id);
    await writeTextFile(registryPath, toJson({
      chatId: state.chatId,
      ...(state.projectPath ? { projectPath: state.projectPath } : {}),
    }));
    const directory = await this.sessionDirectory(state.id);
    if (!(await exists(directory))) await mkdir(directory, { recursive: true });
    await writeTextFile(await join(directory, "state.json"), toJson(state));
  }

  async load(id: string): Promise<FocusState> {
    const path = await join(await this.sessionDirectory(id), "state.json");
    return JSON.parse(await readTextFile(path)) as FocusState;
  }

  async saveMemory(id: string, sectionNumber: number, memory: FocusMemory): Promise<void> {
    const directory = await join(await this.sessionDirectory(id), "sections", String(sectionNumber));
    if (!(await exists(directory))) await mkdir(directory, { recursive: true });
    await writeTextFile(await join(directory, "memory.json"), toJson(memory));
  }

  async append(id: string, sectionNumber: number, kind: FocusLogKind, data: unknown): Promise<FocusLogEntry> {
    const entry: FocusLogEntry = {
      id: newId(), focusId: id, sectionNumber,
      time: new Date().toISOString(), kind, data,
    };
    const directory = await join(await this.sessionDirectory(id), "sections", String(sectionNumber), "history");
    if (!(await exists(directory))) await mkdir(directory, { recursive: true });
    await writeTextFile(await join(directory, `${entry.id}.json`), toJson(entry));
    return entry;
  }

  async readSectionHistory(id: string, sectionNumber: number): Promise<FocusLogEntry[]> {
    const directory = await join(await this.sessionDirectory(id), "sections", String(sectionNumber), "history");
    if (!(await exists(directory))) return [];
    const entries: FocusLogEntry[] = [];
    for (const file of await readDir(directory)) {
      const name = file.name ?? "";
      if (!name.endsWith(".json")) continue;
      try {
        entries.push(JSON.parse(await readTextFile(await join(directory, name))) as FocusLogEntry);
      } catch {
        // Ignore a damaged history entry; the rest of the section remains usable.
      }
    }
    return entries.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  }

  async readHistory(id: string, sectionNumber: number, offset = 0, limit = 20): Promise<{
    entries: Array<{ id: string; time: string; kind: FocusLogKind; preview: string; truncated: boolean }>;
    nextOffset: number | null;
  }> {
    const all = await this.readSectionHistory(id, sectionNumber);
    const start = Math.max(0, offset);
    const page = all.slice(start, start + Math.min(Math.max(limit, 1), 50));
    const entries = page.map((entry) => {
      const preview = JSON.stringify(entry.data) ?? "null";
      return { id: entry.id, time: entry.time, kind: entry.kind, preview: preview.slice(0, 1800), truncated: preview.length > 1800 };
    });
    return { entries, nextOffset: start + page.length < all.length ? start + page.length : null };
  }

  async readEntry(id: string, entryId: string, offset = 0, length = 6000): Promise<{ text: string; nextOffset: number | null }> {
    const registry = await this.readRegistry(id);
    if (!registry) return { text: "", nextOffset: null };
    for (const sectionNumber of Object.keys((await this.load(id)).memories).map(Number)) {
      const entry = (await this.readSectionHistory(id, sectionNumber)).find((item) => item.id === entryId);
      if (!entry) continue;
      const text = JSON.stringify(entry.data, null, 2) ?? "null";
      const start = Math.max(0, offset);
      const size = Math.min(Math.max(length, 1), 20000);
      return { text: text.slice(start, start + size), nextOffset: start + size < text.length ? start + size : null };
    }
    // The active section has no saved memory yet, so search it too.
    const state = await this.load(id);
    const entry = (await this.readSectionHistory(id, state.currentSectionNumber)).find((item) => item.id === entryId);
    if (!entry) return { text: "", nextOffset: null };
    const text = JSON.stringify(entry.data, null, 2) ?? "null";
    const start = Math.max(0, offset);
    const size = Math.min(Math.max(length, 1), 20000);
    return { text: text.slice(start, start + size), nextOffset: start + size < text.length ? start + size : null };
  }

  async getChatSessionIds(chatId: string): Promise<string[]> {
    const root = await this.rootPromise;
    const registryPath = await join(root, "registry");
    const ids: string[] = [];
    for (const file of await readDir(registryPath)) {
      const name = file.name ?? "";
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      const registry = await this.readRegistry(id);
      if (registry?.chatId === chatId) ids.push(id);
    }
    return ids;
  }
}
