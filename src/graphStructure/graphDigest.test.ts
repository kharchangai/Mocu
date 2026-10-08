import { beforeEach, describe, expect, it, vi } from "vitest";

const searchRunGraphsMock = vi.fn();
const getRunGraphByIdMock = vi.fn();

vi.mock("./graphSearch", () => ({
  searchRunGraphs: (...args: unknown[]) => searchRunGraphsMock(...args),
  getRunGraphById: (...args: unknown[]) => getRunGraphByIdMock(...args),
}));
vi.mock("../chat/project/memory/projectMemoryOperationQueue", () => ({
  runProjectMemoryExclusive: async <T>(callback: () => Promise<T>) => callback(),
}));

import { buildRunGraphDigest, getRunGraphToolLog, searchRunGraphHints } from "./graphDigest";

const stored = {
  agentKind: "project",
  savedAt: 1,
  searchable: { userMessage: "implement memory", finalAnswer: "created memory module", toolSummary: "" },
  graph: {
    runId: "run-1",
    agentKind: "project",
    nodes: [
      { id: "tool:a", kind: "tool_call", label: "read_file", at: 1, attributes: { toolCallId: "call-a", args: { path: "src/a.ts" }, result: "read src/a.ts", status: "done" } },
    ],
    edges: [],
  },
};

describe("global run-graph agent retrieval", () => {
  beforeEach(() => {
    searchRunGraphsMock.mockReset();
    getRunGraphByIdMock.mockReset();
    getRunGraphByIdMock.mockResolvedValue(stored);
  });

  it("keeps the automatic hint compact and excludes graph tool details", async () => {
    searchRunGraphsMock.mockResolvedValue({
      matches: [{ runId: "run-1", score: 0.8, searchable: { userMessage: "private question" }, graph: stored.graph }],
      totalGraphs: 1,
    });
    const hint = await searchRunGraphHints(undefined, "how does memory work?");
    expect(hint).toContain("run-1");
    expect(hint).toContain("0.8");
    expect(hint).not.toContain("read_file");
    expect(hint).not.toContain("src/a.ts");
    expect(hint).not.toContain("call-a");
    expect(hint).not.toContain("private question");
    expect(searchRunGraphsMock).toHaveBeenCalledWith(undefined, "how does memory work?", { limit: 2 });
  });

  it("returns only prior tool names and inputs from the digest tool", async () => {
    const result = JSON.parse(await buildRunGraphDigest(undefined, "how does memory work?", "run-1"));
    expect(result.found).toBe(true);
    expect(result.toolCalls[0]).toMatchObject({ name: "read_file", args: { path: "src/a.ts" } });
    expect(JSON.stringify(result)).not.toContain("implement memory");
    expect(JSON.stringify(result)).not.toContain("created memory module");
  });

  it("returns the full result for exactly the requested tool call", async () => {
    const result = JSON.parse(await getRunGraphToolLog(undefined, "run-1", "call-a"));
    expect(result).toMatchObject({ found: true, runId: "run-1", toolCallId: "call-a", result: "read src/a.ts", status: "done" });
    expect(getRunGraphByIdMock).toHaveBeenCalledWith(undefined, "run-1");
  });
});
