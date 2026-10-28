import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  load: vi.fn(),
  execute: vi.fn(),
  select: vi.fn(),
  getJevDecision: vi.fn(),
  getAsyncLLM: vi.fn(),
  embedText: vi.fn(),
  compareEmbeddingToList: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/").replace(/\\/g, "/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: mocks.exists,
  mkdir: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: mocks.load },
}));
vi.mock("../../../../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision: mocks.getJevDecision,
}));
vi.mock("../../../../services/ai/llm", () => ({
  getAsyncLLM: mocks.getAsyncLLM,
}));
vi.mock("../../../../services/ai/tools/textSimilarity", () => ({
  textSimilarity: {
    embedText: mocks.embedText,
    compareEmbeddingToList: mocks.compareEmbeddingToList,
  },
}));

import type { ProjectPersonalMemoryEntry } from "./createPersonalMemoryEntries";
import {
  PROJECT_PERSONAL_MEMORY_DATABASE_FILE,
  resetProjectPersonalMemoryDatabaseCacheForTests,
  saveProjectPersonalMemoryEntries,
} from "./saveProjectPersonalMemoryEntries";

const entry: ProjectPersonalMemoryEntry = {
  memoryText: "I prefer concise answers.",
  searchText: "Concise response preference",
  embedding: [1, 0],
  prompt: "Keep answers concise.",
  tags: ["preference", "global", "explicit"],
  storageScope: "project",
};

function choice(action: string) {
  const similar = mocks.rows.find((row) => row.status === "active");
  const suffix = action === "create_new" ? "" : `:${String(similar?.memory_id)}`;
  mocks.getJevDecision.mockResolvedValue({
    answers: { memoryAction: { choice: `${action}${suffix}` } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  resetProjectPersonalMemoryDatabaseCacheForTests();
  mocks.exists.mockResolvedValue(false);
  mocks.select.mockImplementation(async (sql: string) =>
    sql.includes("SELECT * FROM project_personal_memories")
      ? mocks.rows.filter((row) => row.status === "active").map((row) => ({ ...row }))
      : [],
  );
  mocks.execute.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("INSERT INTO project_personal_memories")) {
      const [memory_id, memory_text, search_text, embedding_json, prompt, tags_json, created_at, updated_at] = values;
      mocks.rows.push({
        memory_id, memory_text, search_text, embedding_json, prompt, tags_json,
        storage_scope: "project", status: "active", created_at, updated_at,
        archived_at: null, archive_reason: null, replaced_by_id: null,
      });
      return { rowsAffected: 1 };
    }
    if (sql.includes("UPDATE project_personal_memories") && sql.includes("status = 'archived'")) {
      const [updated_at, archived_at, archive_reason, replaced_by_id, memory_id] = values;
      const row = mocks.rows.find((item) => item.memory_id === memory_id && item.status === "active");
      if (!row) return { rowsAffected: 0 };
      Object.assign(row, { status: "archived", updated_at, archived_at, archive_reason, replaced_by_id });
      return { rowsAffected: 1 };
    }
    if (sql.includes("UPDATE project_personal_memories") && sql.includes("SET memory_text")) {
      const [memory_text, search_text, embedding_json, prompt, tags_json, updated_at, memory_id] = values;
      const row = mocks.rows.find((item) => item.memory_id === memory_id && item.status === "active");
      if (!row) return { rowsAffected: 0 };
      Object.assign(row, { memory_text, search_text, embedding_json, prompt, tags_json, updated_at });
      return { rowsAffected: 1 };
    }
    if (sql.includes("DELETE FROM project_personal_memories")) {
      const index = mocks.rows.findIndex((item) => item.memory_id === values[0]);
      if (index >= 0) mocks.rows.splice(index, 1);
      return { rowsAffected: index >= 0 ? 1 : 0 };
    }
    return { rowsAffected: 0 };
  });
  mocks.load.mockResolvedValue({ execute: mocks.execute, select: mocks.select });
  mocks.compareEmbeddingToList.mockImplementation((_embedding: number[], targets: Array<{ id: string }>) => ({
    matches: targets.map((target) => ({ id: target.id, score: 0.95 })),
  }));
  mocks.getAsyncLLM.mockResolvedValue({
    withStructuredOutput: () => ({
      invoke: vi.fn().mockResolvedValue({
        memoryText: "I prefer concise answers and short summaries.",
        searchText: "Concise answers and short summaries",
        prompt: "Keep answers concise and summaries short.",
      }),
    }),
  });
  mocks.embedText.mockResolvedValue([0.8, 0.2]);
});

describe("saveProjectPersonalMemoryEntries", () => {
  it("creates a separate project-local SQLite database and stores entries", async () => {
    const result = await saveProjectPersonalMemoryEntries("C:/work/project", [entry]);

    expect(result.databaseCreated).toBe(true);
    expect(result.databasePath).toContain(PROJECT_PERSONAL_MEMORY_DATABASE_FILE);
    expect(result.items.map((item) => item.action)).toEqual(["created"]);
    expect(mocks.execute.mock.calls.some(([sql]) => String(sql).includes("CREATE TABLE IF NOT EXISTS project_personal_memories"))).toBe(true);
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].storage_scope).toBe("project");
  });

  it("ignores an exact duplicate selected by the decision model", async () => {
    await saveProjectPersonalMemoryEntries("C:/work/project", [entry]);
    choice("ignore_duplicate");

    const result = await saveProjectPersonalMemoryEntries("C:/work/project", [entry]);

    expect(result.items[0].action).toBe("duplicate");
    expect(mocks.rows).toHaveLength(1);
  });

  it("merges compatible new information with the configured cheap model", async () => {
    await saveProjectPersonalMemoryEntries("C:/work/project", [entry]);
    choice("merge");

    const result = await saveProjectPersonalMemoryEntries("C:/work/project", [{
      ...entry,
      memoryText: "I also prefer short summaries.",
      searchText: "Short summary preference",
      prompt: "Use short summaries.",
    }]);

    expect(result.items[0].action).toBe("merged");
    expect(mocks.getAsyncLLM).toHaveBeenCalledWith("cheap", { temperature: 0, maxTokens: 800 });
    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0].memory_text).toBe("I prefer concise answers and short summaries.");
    expect(mocks.embedText).toHaveBeenCalledWith("Concise answers and short summaries");
  });

  it("archives a conflicting instruction and saves its replacement", async () => {
    await saveProjectPersonalMemoryEntries("C:/work/project", [entry]);
    const oldId = String(mocks.rows[0].memory_id);
    choice("replace");

    const result = await saveProjectPersonalMemoryEntries("C:/work/project", [{
      ...entry,
      memoryText: "I prefer detailed answers now.",
      searchText: "Detailed answer preference",
      prompt: "Give detailed answers.",
    }]);

    expect(result.items[0].action).toBe("replaced");
    expect(mocks.rows).toHaveLength(2);
    expect(mocks.rows.find((row) => row.memory_id === oldId)).toMatchObject({
      status: "archived",
      replaced_by_id: result.items[0].memoryId,
    });
    expect(mocks.rows.find((row) => row.memory_id === result.items[0].memoryId)?.status).toBe("active");
  });
});
