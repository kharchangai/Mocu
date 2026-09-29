import { beforeEach, describe, expect, it, vi } from "vitest";

const searchRunGraphsMock = vi.fn();
const getRunGraphByIdMock = vi.fn();
const getJevDecisionMock = vi.fn();
const compareSnapshotMock = vi.fn();
const useProjectDatabaseMock = vi.fn();

vi.mock("./graphSearch", () => ({
  searchRunGraphs: (...args: unknown[]) => searchRunGraphsMock(...args),
  getRunGraphById: (...args: unknown[]) => getRunGraphByIdMock(...args),
}));
vi.mock("../chat/project/memory/storage/databaseManager", () => ({
  databaseManager: { useProjectDatabase: (...args: unknown[]) => useProjectDatabaseMock(...args) },
}));
vi.mock("../chat/project/memory/projectMemoryOperationQueue", () => ({
  runProjectMemoryExclusive: async <T>(callback: () => Promise<T>) => callback(),
}));
vi.mock("../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision: (...args: unknown[]) => getJevDecisionMock(...args),
}));
vi.mock("./fileSnapshot", () => ({
  buildCompactDigest: (input: unknown) => JSON.stringify(input),
  compareProjectFileSnapshot: (...args: unknown[]) => compareSnapshotMock(...args),
  getGraphFilePaths: () => ["C:/project/src/a.ts"],
  summarizeToolNode: (node: { label: string; attributes: Record<string, unknown> }) => `${node.label} ${String(node.attributes.result ?? "")}`,
}));

import { buildRunGraphDigest } from "./graphDigest";

const stored = {
  agentKind: "project",
  savedAt: 1,
  searchable: { userMessage: "implement memory", finalAnswer: "created memory module", toolSummary: "" },
  fileSnapshot: { "src/a.ts": "old" },
  graph: {
    runId: "run-1",
    agentKind: "project",
    nodes: [
      { id: "tool:a", kind: "tool_call", label: "read_file", at: 1, attributes: { result: "read src/a.ts" } },
      { id: "tool:b", kind: "tool_call", label: "terminal_executor", at: 2, attributes: { result: "ran test" } },
    ],
    edges: [],
  },
};

describe("buildRunGraphDigest", () => {
  beforeEach(() => {
    searchRunGraphsMock.mockReset();
    getRunGraphByIdMock.mockReset();
    getJevDecisionMock.mockReset();
    compareSnapshotMock.mockReset();
    useProjectDatabaseMock.mockReset();
    searchRunGraphsMock.mockResolvedValue({ matches: [{ runId: "run-1", score: 0.8 }], totalGraphs: 1 });
    getRunGraphByIdMock.mockResolvedValue(stored);
    getJevDecisionMock.mockResolvedValue({ answers: { relevantNow: { noul: 0.9 } } });
    compareSnapshotMock.mockResolvedValue({ "src/a.ts": "modified" });
  });

  it("searches and returns a compact JEV-filtered, freshness-marked digest", async () => {
    const result = JSON.parse(await buildRunGraphDigest("C:/project", "how does memory work?"));
    expect(searchRunGraphsMock).toHaveBeenCalledWith("C:/project", "how does memory work?", { limit: 3 });
    expect(result.found).toBe(true);
    expect(result.digest.items).toHaveLength(2);
    expect(result.digest.items[0].paths[0].freshness).toBe("modified");
  });

  it("does not include tool records JEV rejects", async () => {
    getJevDecisionMock
      .mockResolvedValueOnce({ answers: { relevantNow: { noul: 0.1 } } })
      .mockResolvedValueOnce({ answers: { relevantNow: { noul: 0.1 } } });
    const result = JSON.parse(await buildRunGraphDigest("C:/project", "unrelated request"));
    expect(result.found).toBe(false);
  });
});
