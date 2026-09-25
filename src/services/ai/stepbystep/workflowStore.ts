import { exists, mkdir, readTextFile, readDir, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

import type {
  LogEntry,
  LogKind,
  StepMemory,
  WorkflowState,
} from "./types";

function toJson(value: unknown): string {
  const result = JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") {
        return item.toString();
      }

      if (item instanceof Error) {
        return {
          name: item.name,
          message: item.message,
        };
      }

      return item;
    },
    2,
  );

  return result ?? "null";
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Workflow files are stored with the project when one is selected:
 *   <project>/.mocu/step-by-step-workflows/<workflow>/state.json
 *   <project>/.mocu/step-by-step-workflows/<workflow>/steps/<n>/logs/*.json
 *
 * AppData only keeps the active chat pointer and a small location registry so
 * the chat ID can find the project-local workflow after an app restart. Chats
 * without a project use the legacy AppData root.
 */
export class WorkflowStore {
  private readonly rootPromise: Promise<string>;

  constructor() {
    this.rootPromise = this.resolveRoot();
  }

  private async resolveRoot(): Promise<string> {
    const baseDir = await appDataDir();
    const root = await join(baseDir, "step-by-step-workflows");

    if (!(await exists(root))) {
      await mkdir(root, { recursive: true });
    }

    const registry = await join(root, "registry");
    if (!(await exists(registry))) {
      await mkdir(registry, { recursive: true });
    }

    return root;
  }

  private validateId(id: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error("Invalid workflow ID.");
    }
  }

  private async registryFile(id: string): Promise<string> {
    this.validateId(id);
    return join(await this.rootPromise, "registry", `${id}.json`);
  }

  private async readRegistry(id: string): Promise<{ chatId: string; projectPath?: string } | null> {
    const path = await this.registryFile(id);

    if (!(await exists(path))) {
      return null;
    }

    try {
      return JSON.parse(await readTextFile(path)) as {
        chatId: string;
        projectPath?: string;
      };
    } catch {
      return null;
    }
  }

  private async writeRegistry(state: WorkflowState): Promise<void> {
    const path = await this.registryFile(state.id);
    await writeTextFile(
      path,
      toJson({
        chatId: state.chatId,
        ...(state.projectPath ? { projectPath: state.projectPath } : {}),
      }),
    );
  }

  private async directory(id: string): Promise<string> {
    this.validateId(id);
    const root = await this.rootPromise;
    const registry = await this.readRegistry(id);

    if (registry?.projectPath?.trim()) {
      return join(
        registry.projectPath,
        ".mocu",
        "step-by-step-workflows",
        id,
      );
    }

    // No registry means this may be a workflow created by an older version.
    return join(root, id);
  }

  private async stepLogsDirectory(workflowId: string, stepNumber: number): Promise<string> {
    return join(await this.directory(workflowId), "steps", String(stepNumber), "logs");
  }

  private async logDirectories(workflowId: string, stepNumber?: number): Promise<string[]> {
    const workflowDirectory = await this.directory(workflowId);
    const result: string[] = [];
    const legacyLogs = await join(workflowDirectory, "logs");

    if (await exists(legacyLogs)) {
      result.push(legacyLogs);
    }

    const stepsDirectory = await join(workflowDirectory, "steps");
    if (!(await exists(stepsDirectory))) {
      return result;
    }

    if (stepNumber !== undefined) {
      const path = await join(stepsDirectory, String(stepNumber), "logs");
      if (await exists(path)) result.push(path);
      return result;
    }

    for (const step of await readDir(stepsDirectory)) {
      const name = step.name ?? "";
      if (!/^\d+$/.test(name)) continue;
      const path = await join(stepsDirectory, name, "logs");
      if (await exists(path)) result.push(path);
    }

    return result;
  }

  private async readEntries(workflowId: string, stepNumber?: number): Promise<LogEntry[]> {
    const directories = await this.logDirectories(workflowId, stepNumber);
    const entries: LogEntry[] = [];

    for (const logsDirectory of directories) {
      for (const filename of await readDir(logsDirectory)) {
        const name = filename.name ?? "";
        if (!name.endsWith(".json")) continue;

        try {
          const entry = JSON.parse(
            await readTextFile(await join(logsDirectory, name)),
          ) as LogEntry;

          if (stepNumber === undefined || entry.stepNumber === stepNumber) {
            entries.push(entry);
          }
        } catch {
          // A corrupted log entry must never break retrieval.
        }
      }
    }

    return entries.sort(
      (a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id),
    );
  }

  /* Chat index: only IDs are kept globally; workflow contents stay project-local. */

  private async indexFile(): Promise<string> {
    return join(await this.rootPromise, "index.json");
  }

  async setChatWorkflow(chatId: string, workflowId: string | null): Promise<void> {
    const path = await this.indexFile();
    let index: Record<string, string> = {};

    if (await exists(path)) {
      try {
        index = JSON.parse(await readTextFile(path)) as Record<string, string>;
      } catch {
        index = {};
      }
    }

    if (workflowId) index[chatId] = workflowId;
    else delete index[chatId];

    await writeTextFile(path, toJson(index));
  }

  async getChatWorkflowIds(chatId: string): Promise<string[]> {
    const root = await this.rootPromise;
    const ids = new Set<string>();
    const registryDirectory = await join(root, "registry");

    for (const entry of await readDir(registryDirectory)) {
      const filename = entry.name ?? "";
      if (!filename.endsWith(".json")) continue;
      const workflowId = filename.slice(0, -5);
      if (!/^[a-zA-Z0-9_-]+$/.test(workflowId)) continue;

      const registry = await this.readRegistry(workflowId);
      if (registry?.chatId === chatId) ids.add(workflowId);
    }

    // Discover legacy AppData workflows created before the location registry.
    for (const entry of await readDir(root)) {
      const workflowId = entry.name ?? "";
      if (!/^[a-zA-Z0-9_-]+$/.test(workflowId)) continue;
      if (ids.has(workflowId)) continue;

      try {
        const statePath = await join(root, workflowId, "state.json");
        if (!(await exists(statePath))) continue;
        const state = JSON.parse(await readTextFile(statePath)) as Partial<WorkflowState>;
        if (state.chatId === chatId) ids.add(workflowId);
      } catch {
        // Ignore unrelated folders and corrupt legacy state files.
      }
    }

    return [...ids];
  }

  async getChatWorkflow(chatId: string): Promise<string | null> {
    const path = await this.indexFile();
    if (!(await exists(path))) return null;

    try {
      const index = JSON.parse(await readTextFile(path)) as Record<string, string>;
      return index[chatId] ?? null;
    } catch {
      return null;
    }
  }

  /* Workflow state ---------------------------------------------------------- */

  async save(state: WorkflowState): Promise<void> {
    await this.writeRegistry(state);
    const directory = await this.directory(state.id);

    if (!(await exists(directory))) {
      await mkdir(directory, { recursive: true });
    }

    await writeTextFile(await join(directory, "state.json"), toJson(state));
  }

  async load(workflowId: string): Promise<WorkflowState> {
    const directory = await this.directory(workflowId);
    const text = await readTextFile(await join(directory, "state.json"));
    return JSON.parse(text) as WorkflowState;
  }

  async saveStepMemory(workflowId: string, stepNumber: number, memory: StepMemory): Promise<void> {
    const stepDirectory = await join(await this.directory(workflowId), "steps", String(stepNumber));
    if (!(await exists(stepDirectory))) {
      await mkdir(stepDirectory, { recursive: true });
    }

    await writeTextFile(await join(stepDirectory, "memory.json"), toJson(memory));
  }

  /* Detailed logs ----------------------------------------------------------- */

  async append(
    workflowId: string,
    stepNumber: number,
    kind: LogKind,
    data: unknown,
  ): Promise<LogEntry> {
    const entry: LogEntry = {
      id: generateId(),
      workflowId,
      stepNumber,
      time: new Date().toISOString(),
      kind,
      data,
    };

    const logsDirectory = await this.stepLogsDirectory(workflowId, stepNumber);
    if (!(await exists(logsDirectory))) {
      await mkdir(logsDirectory, { recursive: true });
    }

    await writeTextFile(await join(logsDirectory, `${entry.id}.json`), toJson(entry));
    return entry;
  }

  /** Returns complete, untruncated log entries for one step. */
  async readStepHistory(workflowId: string, stepNumber: number): Promise<LogEntry[]> {
    return this.readEntries(workflowId, stepNumber);
  }

  async readLogs(
    workflowId: string,
    stepNumber: number,
    offset = 0,
    limit = 10,
    kind?: LogKind,
  ): Promise<{
    entries: Array<{
      id: string;
      time: string;
      kind: LogKind;
      preview: string;
      truncated: boolean;
    }>;
    nextOffset: number | null;
  }> {
    const entries = (await this.readEntries(workflowId, stepNumber))
      .filter((entry) => !kind || entry.kind === kind);
    const size = Math.min(Math.max(limit, 1), 20);
    const start = Math.max(offset, 0);
    const page = entries.slice(start, start + size);

    return {
      entries: page.map((entry) => {
        const text = toJson(entry.data);
        return {
          id: entry.id,
          time: entry.time,
          kind: entry.kind,
          preview: text.slice(0, 2000),
          truncated: text.length > 2000,
        };
      }),
      nextOffset: start + page.length < entries.length ? start + page.length : null,
    };
  }

  /** Reads logs across all step folders, for the log viewer. */
  async readAllLogs(
    workflowId: string,
    offset = 0,
    limit = 20,
  ): Promise<{
    entries: Array<{
      id: string;
      stepNumber: number;
      time: string;
      kind: LogKind;
      preview: string;
      truncated: boolean;
    }>;
    nextOffset: number | null;
  }> {
    const entries = await this.readEntries(workflowId);
    const size = Math.min(Math.max(limit, 1), 400);
    const start = Math.max(offset, 0);
    const page = entries.slice(start, start + size);

    return {
      entries: page.map((entry) => {
        const text = toJson(entry.data);
        return {
          id: entry.id,
          stepNumber: entry.stepNumber,
          time: entry.time,
          kind: entry.kind,
          preview: text.slice(0, 2000),
          truncated: text.length > 2000,
        };
      }),
      nextOffset: start + page.length < entries.length ? start + page.length : null,
    };
  }

  async readLogEntry(
    workflowId: string,
    logId: string,
    offset = 0,
    length = 6000,
  ): Promise<{
    text: string;
    nextOffset: number | null;
  }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(logId)) {
      throw new Error("Invalid log ID.");
    }

    const directories = await this.logDirectories(workflowId);
    let text = "";

    for (const logsDirectory of directories) {
      const path = await join(logsDirectory, `${logId}.json`);
      if (await exists(path)) {
        text = await readTextFile(path);
        break;
      }
    }

    if (!text) {
      throw new Error("Workflow log entry not found.");
    }

    const start = Math.max(offset, 0);
    const size = Math.min(Math.max(length, 1), 20000);
    const end = Math.min(start + size, text.length);
    return {
      text: text.slice(start, end),
      nextOffset: end < text.length ? end : null,
    };
  }
}
