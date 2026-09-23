import { exists, mkdir, readTextFile, readDir, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";

import type {
  LogEntry,
  LogKind,
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
 * File-backed storage for step-by-step workflows.
 *
 * Layout inside AppData:
 *   step-by-step-workflows/index.json               -> chatId -> workflowId
 *   step-by-step-workflows/<id>/state.json          -> WorkflowState
 *   step-by-step-workflows/<id>/logs/<logId>.json   -> detailed LogEntry
 *
 * Every tool call, tool result, user message, assistant reply, step summary
 * and transition is written to disk, so the agent can later retrieve exactly
 * how an earlier action was performed through its retrieval tools.
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

    return root;
  }

  private async directory(id: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error("Invalid workflow ID.");
    }

    const root = await this.rootPromise;

    return await join(root, id);
  }

  /*
   * Chat index ----------------------------------------------------------------
   */

  private async indexFile(): Promise<string> {
    const root = await this.rootPromise;

    return await join(root, "index.json");
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

    if (workflowId) {
      index[chatId] = workflowId;
    } else {
      delete index[chatId];
    }

    await writeTextFile(path, toJson(index));
  }

  async getChatWorkflow(chatId: string): Promise<string | null> {
    const path = await this.indexFile();

    if (!(await exists(path))) {
      return null;
    }

    try {
      const index = JSON.parse(await readTextFile(path)) as Record<string, string>;

      return index[chatId] ?? null;
    } catch {
      return null;
    }
  }

  /*
   * Workflow state ------------------------------------------------------------
   */

  async save(state: WorkflowState): Promise<void> {
    const directory = await this.directory(state.id);

    if (!(await exists(directory))) {
      await mkdir(directory, { recursive: true });
    }

    await writeTextFile(
      await join(directory, "state.json"),
      toJson(state),
    );
  }

  async load(workflowId: string): Promise<WorkflowState> {
    const directory = await this.directory(workflowId);

    const text = await readTextFile(
      await join(directory, "state.json"),
    );

    return JSON.parse(text) as WorkflowState;
  }

  /*
   * Detailed logs -------------------------------------------------------------
   */

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

    const directory = await this.directory(workflowId);
    const logsDirectory = await join(directory, "logs");

    if (!(await exists(logsDirectory))) {
      await mkdir(logsDirectory, { recursive: true });
    }

    await writeTextFile(
      await join(logsDirectory, `${entry.id}.json`),
      toJson(entry),
    );

    return entry;
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
    const directory = await this.directory(workflowId);
    const logsDirectory = await join(directory, "logs");

    if (!(await exists(logsDirectory))) {
      return { entries: [], nextOffset: null };
    }

    const filenames = await readDir(logsDirectory);

    const entries: LogEntry[] = [];

    for (const filename of filenames) {
      const name = filename.name ?? "";

      if (!name.endsWith(".json")) continue;

      try {
        const entry = JSON.parse(
          await readTextFile(
            await join(logsDirectory, name),
          ),
        ) as LogEntry;

        if (
          entry.stepNumber === stepNumber &&
          (!kind || entry.kind === kind)
        ) {
          entries.push(entry);
        }
      } catch {
        // A corrupted log entry must never break retrieval.
      }
    }

    entries.sort(
      (a, b) =>
        a.time.localeCompare(b.time) ||
        a.id.localeCompare(b.id),
    );

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
      nextOffset:
        start + page.length < entries.length
          ? start + page.length
          : null,
    };
  }

  /**
   * Reads logs across ALL steps of a workflow, for the log viewer.
   */
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
    const directory = await this.directory(workflowId);
    const logsDirectory = await join(directory, "logs");

    if (!(await exists(logsDirectory))) {
      return { entries: [], nextOffset: null };
    }

    const filenames = await readDir(logsDirectory);

    const entries: LogEntry[] = [];

    for (const filename of filenames) {
      const name = filename.name ?? "";

      if (!name.endsWith(".json")) continue;

      try {
        const entry = JSON.parse(
          await readTextFile(
            await join(logsDirectory, name),
          ),
        ) as LogEntry;

        entries.push(entry);
      } catch {
        // A corrupted log entry must never break retrieval.
      }
    }

    entries.sort(
      (a, b) =>
        a.time.localeCompare(b.time) ||
        a.id.localeCompare(b.id),
    );

    const size = Math.min(Math.max(limit, 1), 50);
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
      nextOffset:
        start + page.length < entries.length
          ? start + page.length
          : null,
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

    const directory = await this.directory(workflowId);

    const text = await readTextFile(
      await join(directory, "logs", `${logId}.json`),
    );

    const start = Math.max(offset, 0);
    const size = Math.min(Math.max(length, 1), 20000);
    const end = Math.min(start + size, text.length);

    return {
      text: text.slice(start, end),
      nextOffset: end < text.length ? end : null,
    };
  }
}
