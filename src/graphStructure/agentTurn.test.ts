import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanRunRecords: vi.fn(),
  createGraphDigestTool: vi.fn(),
  searchRunGraphHints: vi.fn(),
  buildGraph: vi.fn(),
  createGraphRecorder: vi.fn(),
  saveRunGraph: vi.fn(),
  shouldRouteToGraphSystem: vi.fn(),
  exclusive: vi.fn(async (callback: () => unknown) => callback()),
}));

vi.mock("./cleanup", () => ({ cleanRunRecords: mocks.cleanRunRecords }));
vi.mock("./graphDigest", () => ({
  createGraphDigestTool: mocks.createGraphDigestTool,
  searchRunGraphHints: mocks.searchRunGraphHints,
}));
vi.mock("./graphMaker", () => ({ buildGraph: mocks.buildGraph }));
vi.mock("./recorder", () => ({ createGraphRecorder: mocks.createGraphRecorder }));
vi.mock("./graphStorage", () => ({ saveRunGraph: mocks.saveRunGraph }));
vi.mock("./jevGate", () => ({ shouldRouteToGraphSystem: mocks.shouldRouteToGraphSystem }));
vi.mock("../chat/project/memory/projectMemoryOperationQueue", () => ({ runProjectMemoryExclusive: mocks.exclusive }));

import { persistAgentGraphTurn, prepareAgentGraphTurn } from "./agentTurn";

describe("specialist agent graph turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchRunGraphHints.mockResolvedValue("prior graph hint");
    mocks.shouldRouteToGraphSystem.mockResolvedValue(false);
    mocks.createGraphDigestTool.mockReturnValue({ runnable: { name: "get_relevant_run_graph_digest" } });
    mocks.cleanRunRecords.mockResolvedValue({ kept: [{ type: "run_start" }] });
    mocks.buildGraph.mockReturnValue({ runId: "run-focus" });
    mocks.saveRunGraph.mockResolvedValue({ key: "run-focus", embedded: true });
  });

  it("provides prior-run hint and digest tool even when the recording gate declines", async () => {
    const prepared = await prepareAgentGraphTurn({
      agentKind: "focus",
      chatId: "chat-1",
      projectPath: "E:/project",
      userMessage: "Inspect the project structure",
    });

    expect(prepared.graphHint).toBe("prior graph hint");
    expect(prepared.digestTool?.name).toBe("get_relevant_run_graph_digest");
    expect(prepared.recorder).toBeNull();
    expect(mocks.searchRunGraphHints).toHaveBeenCalledWith("E:/project", "Inspect the project structure");
    expect(mocks.shouldRouteToGraphSystem).toHaveBeenCalledOnce();
  });

  it("records and persists a gated step-by-step run graph", async () => {
    const recorder = {
      runId: "run-step",
      agentKind: "stepbystep",
      chatId: "chat-2",
      startRun: vi.fn(),
      recordModelCall: vi.fn(),
      recordToolCall: vi.fn(),
      finishRun: vi.fn(),
      getRecords: vi.fn(() => [{ type: "run_start" }]),
    };
    mocks.shouldRouteToGraphSystem.mockResolvedValue(true);
    mocks.createGraphRecorder.mockReturnValue(recorder);

    const prepared = await prepareAgentGraphTurn({
      agentKind: "stepbystep",
      chatId: "chat-2",
      projectPath: "E:/project",
      userMessage: "Explore files and implement feature",
    });
    await persistAgentGraphTurn(prepared, "Implemented the feature", "[Step Workflow]");

    expect(recorder.startRun).toHaveBeenCalledWith("Explore files and implement feature");
    expect(recorder.finishRun).toHaveBeenCalledWith("Implemented the feature");
    expect(mocks.cleanRunRecords).toHaveBeenCalledOnce();
    expect(mocks.buildGraph).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-step",
      agentKind: "stepbystep",
      projectPath: "E:/project",
    }));
    expect(mocks.saveRunGraph).toHaveBeenCalledOnce();
  });

  it("does not attempt graph services without an active project path", async () => {
    const prepared = await prepareAgentGraphTurn({
      agentKind: "focus",
      chatId: "chat-3",
      userMessage: "Explore files",
    });

    expect(prepared).toMatchObject({ projectPath: "", recorder: null, graphHint: "", digestTool: null });
    expect(mocks.searchRunGraphHints).not.toHaveBeenCalled();
    expect(mocks.shouldRouteToGraphSystem).not.toHaveBeenCalled();
  });
});
