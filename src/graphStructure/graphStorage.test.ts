import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appDataDir: vi.fn(async () => "C:/Users/test/AppData/Roaming/com.mocu.app"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
  mkdir: vi.fn(async () => undefined),
  load: vi.fn(),
  execute: vi.fn(async () => ({ rowsAffected: 1 })),
  select: vi.fn(),
  embedText: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ appDataDir: mocks.appDataDir, join: mocks.join }));
vi.mock("@tauri-apps/plugin-fs", () => ({ BaseDirectory: { AppData: "AppData" }, mkdir: mocks.mkdir }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: mocks.load } }));
vi.mock("../services/ai/tools/textSimilarity", () => ({ textSimilarity: { embedText: mocks.embedText } }));
vi.mock("../store", () => ({ readSettings: mocks.readSettings }));

import { graphDatabaseUrl, listRunGraphs, loadRunGraph, resetGraphDatabaseCacheForTests, saveRunGraph } from "./graphStorage";

const graph = {
  runId: "run-1", agentKind: "project", nodes: [], edges: [],
};

describe("global run graph storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGraphDatabaseCacheForTests();
    const db = {
      execute: mocks.execute,
      select: mocks.select,
    };
    mocks.load.mockResolvedValue(db);
    mocks.select.mockImplementation(async (query: string) => {
      if (query === "SELECT 1") return [{ "1": 1 }];
      if (query.includes("WHERE run_id")) return [];
      return [];
    });
    mocks.readSettings.mockRejectedValue(new Error("settings unavailable"));
  });
  it("builds the database URL inside application AppData", async () => {
    expect(await graphDatabaseUrl()).toBe("sqlite:C:/Users/test/AppData/Roaming/com.mocu.app/graph/run-graphs.db");
  });

  it("writes the graph row before optional embedding and keeps it when embedding setup fails", async () => {
    const result = await saveRunGraph("E:/some-project", graph);
    expect(result).toMatchObject({ key: "run-1", embedded: false });
    expect(mocks.mkdir).toHaveBeenCalledWith("graph", { baseDir: "AppData", recursive: true });
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO run_graphs"), expect.any(Array));
    expect(mocks.execute).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE run_graphs"), expect.any(Array));
    expect(mocks.load).toHaveBeenCalledWith("sqlite:C:/Users/test/AppData/Roaming/com.mocu.app/graph/run-graphs.db");
  });

  it("loads and lists graph rows from the global graph database", async () => {
    const payload = JSON.stringify({ graph, searchable: {}, savedAt: 1 });
    mocks.select.mockImplementation(async (query: string) => {
      if (query === "SELECT 1") return [{ "1": 1 }];
      if (query.includes("WHERE run_id")) return [{ payload }];
      return [{ payload }];
    });
    expect(await loadRunGraph(undefined, "run-1")).toMatchObject({ graph });
    expect(await listRunGraphs()).toHaveLength(1);
  });
});
