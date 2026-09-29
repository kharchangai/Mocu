// src/graphStructure/graphSearch.test.ts
//
// Unit tests for the step-5 graph retrieval layer. No database or
// embedding service is required: keyword scoring is pure, and the
// search/tools tests mock listRunGraphs / textSimilarity.

import { beforeEach, describe, expect, it, vi } from "vitest";

const listRunGraphsMock = vi.fn();
const loadRunGraphMock = vi.fn();
const embedTextMock = vi.fn();

vi.mock("./graphStorage", () => ({
  RUN_GRAPH_RECORD_TYPE: "run_graph",
  listRunGraphs: (...args: unknown[]) => listRunGraphsMock(...args),
  loadRunGraph: (...args: unknown[]) => loadRunGraphMock(...args),
}));

vi.mock("../services/ai/tools/textSimilarity", () => ({
  textSimilarity: {
    embedText: (...args: unknown[]) => embedTextMock(...args),
  },
}));

import { keywordScore, searchRunGraphs } from "./graphSearch";
import { createGraphTools, registerGraphTools } from "./graphTools";
import { ToolExecutor } from "../services/ai/agent/tool-executor";
import type { StoredRunGraphData } from "./graphStorage";

const makeStored = (
  runId: string,
  userMessage: string,
  finalAnswer: string,
  options: { embedding?: number[] | null; savedAt?: number } = {},
): StoredRunGraphData => ({
  agentKind: "chat",
  savedAt: options.savedAt ?? 1,
  graph: {
    runId,
    agentKind: "chat",
    nodes: [],
    edges: [],
  },
  searchable: {
    userMessage,
    finalAnswer,
    toolSummary: "",
  },
  embedding: options.embedding ?? null,
  embeddingModel: options.embedding ? "test-model" : null,
});

describe("keywordScore", () => {
  it("scores higher when more query tokens appear in the candidate", () => {
    const query = "فایل تنظیمات vite پروژه";
    const relevant =
      "پیدا کردن فایل تنظیمات vite در ریشه پروژه ممکن است.";
    const irrelevant = "خبرهای امروز بازار بورس";

    const relevantScore = keywordScore(query, relevant);
    const irrelevantScore = keywordScore(query, irrelevant);

    expect(relevantScore).toBeGreaterThan(irrelevantScore);
    expect(relevantScore).toBeGreaterThan(0.5);
    expect(irrelevantScore).toBe(0);
  });

  it("returns 0 for empty inputs", () => {
    expect(keywordScore("", "anything")).toBe(0);
    expect(keywordScore("query", "")).toBe(0);
  });
});

describe("searchRunGraphs", () => {
  beforeEach(() => {
    listRunGraphsMock.mockReset();
    embedTextMock.mockReset();
  });

  it("ranks keyword-relevant graphs without calling the embedding API", async () => {
    listRunGraphsMock.mockResolvedValue([
      makeStored("run-config", "فایل تنظیمات vite را پیدا کن", "vite.config.ts"),
      makeStored("run-news", "اخبار امروز را خلاصه کن", "خلاصه اخبار"),
    ]);
    embedTextMock.mockRejectedValue(new Error("should not be called"));

    const result = await searchRunGraphs("E:/project", "کجای پروژه تنظیمات vite است؟");

    expect(result.totalGraphs).toBe(2);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.runId).toBe("run-config");
    expect(result.scoring).toBe("keyword");
    expect(result.vectorError).toBeUndefined();
  });

  it("uses vector similarity when embeddings exist", async () => {
    listRunGraphsMock.mockResolvedValue([
      makeStored("run-a", "alpha", "answer a", {
        embedding: [1, 0],
        savedAt: 1,
      }),
      makeStored("run-b", "beta", "answer b", {
        embedding: [0, 1],
        savedAt: 2,
      }),
    ]);
    // Query embedding points strongly at run-a.
    embedTextMock.mockResolvedValue([1, 0]);

    const result = await searchRunGraphs("E:/project", "alpha query");

    expect(embedTextMock).toHaveBeenCalledTimes(1);
    expect(result.matches[0]?.runId).toBe("run-a");
    expect(result.matches[0]?.method).toBe("vector+keyword");
    expect(result.scoring).toBe("vector+keyword");
    expect(result.matches[0]?.score).toBeGreaterThan(
      result.matches[1]?.score ?? 0,
    );
  });

  it("falls back to keywords when the embedding service fails", async () => {
    listRunGraphsMock.mockResolvedValue([
      makeStored("run-a", "فایل تنظیمات vite", "vite.config.ts", {
        embedding: [1, 0],
      }),
    ]);
    embedTextMock.mockRejectedValue(new Error("embedding down"));

    const result = await searchRunGraphs("E:/project", "تنظیمات vite");

    expect(result.vectorError).toBe("embedding down");
    expect(result.matches[0]?.runId).toBe("run-a");
    expect(result.matches[0]?.method).toBe("keyword");
    expect(result.scoring).toBe("keyword");
  });

  it("returns an empty result for an empty project", async () => {
    listRunGraphsMock.mockResolvedValue([]);

    const result = await searchRunGraphs("E:/project", "anything");

    expect(result.matches).toEqual([]);
    expect(result.scoring).toBe("none");
    expect(result.totalGraphs).toBe(0);
    expect(embedTextMock).not.toHaveBeenCalled();
  });
});

describe("graph tools", () => {
  beforeEach(() => {
    listRunGraphsMock.mockReset();
    loadRunGraphMock.mockReset();
    embedTextMock.mockReset();
  });

  it("createGraphTools returns both tools with usable metadata", () => {
    const tools = createGraphTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(["search_run_graph", "get_run_graph"]);
    for (const tool of tools) {
      expect(tool.name.trim()).not.toBe("");
      expect(tool.description.trim().length).toBeGreaterThan(10);
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("registerGraphTools registers both tools on a ToolExecutor", () => {
    const executor = new ToolExecutor();
    const names = registerGraphTools(executor);

    expect(names).toEqual(["search_run_graph", "get_run_graph"]);
    expect(executor.hasTool("search_run_graph")).toBe(true);
    expect(executor.hasTool("get_run_graph")).toBe(true);
    expect(executor.getAvailableTools().map((tool) => tool.name)).toEqual(
      names,
    );
  });

  it("search_run_graph returns JSON matches and fails open on errors", async () => {
    listRunGraphsMock.mockResolvedValue([
      makeStored("run-a", "پیدا کردن فایل تنظیمات vite", "vite.config.ts"),
    ]);
    embedTextMock.mockRejectedValue(new Error("no embedding"));

    const executor = new ToolExecutor();
    registerGraphTools(executor);

    const ok = (await executor.execute("search_run_graph", {
      query: "تنظیمات vite",
      projectPath: "E:/project",
    })) as string;
    const parsedOk = JSON.parse(ok) as { found: boolean; matches: unknown[] };

    expect(parsedOk.found).toBe(true);
    expect(parsedOk.matches).toHaveLength(1);

    // Missing project path throws (required argument).
    await expect(
      executor.execute("search_run_graph", { query: "x" }),
    ).rejects.toThrow(/project/i);

    // Search failure is returned as JSON, not thrown.
    listRunGraphsMock.mockRejectedValue(new Error("db down"));
    const failed = (await executor.execute("search_run_graph", {
      query: "x",
      projectPath: "E:/project",
    })) as string;
    const parsedFailed = JSON.parse(failed) as {
      found: boolean;
      error: string;
    };
    expect(parsedFailed.found).toBe(false);
    expect(parsedFailed.error).toContain("db down");
  });

  it("get_run_graph loads one graph or reports a miss", async () => {
    const stored = makeStored("run-a", "msg", "answer");
    loadRunGraphMock.mockResolvedValueOnce(stored);

    const executor = new ToolExecutor();
    registerGraphTools(executor);

    const hit = (await executor.execute("get_run_graph", {
      runId: "run-a",
      projectPath: "E:/project",
    })) as string;
    const parsedHit = JSON.parse(hit) as { found: boolean; runId: string };

    expect(parsedHit.found).toBe(true);
    expect(parsedHit.runId).toBe("run-a");

    loadRunGraphMock.mockResolvedValueOnce(null);
    const miss = (await executor.execute("get_run_graph", {
      runId: "missing",
      projectPath: "E:/project",
    })) as string;
    const parsedMiss = JSON.parse(miss) as { found: boolean };

    expect(parsedMiss.found).toBe(false);

    await expect(
      executor.execute("get_run_graph", { projectPath: "E:/project" }),
    ).rejects.toThrow(/runId/i);
  });
});
