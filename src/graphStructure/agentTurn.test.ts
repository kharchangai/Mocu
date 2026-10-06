import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanRunRecords: vi.fn(),
  createGraphDigestTool: vi.fn(),
  createGraphToolLogTool: vi.fn(),
  searchRunGraphHints: vi.fn(),
  buildGraph: vi.fn(),
  createGraphRecorder: vi.fn(),
  saveRunGraph: vi.fn(),
  shouldRouteToGraphSystem: vi.fn(),
  exclusive: vi.fn(async (callback: () => unknown) => callback()),
}));

vi.mock("./cleanup", () => ({ cleanRunRecords: mocks.cleanRunRecords }));
vi.mock("./graphDigest", () => ({ createGraphDigestTool: mocks.createGraphDigestTool, createGraphToolLogTool: mocks.createGraphToolLogTool, searchRunGraphHints: mocks.searchRunGraphHints }));
vi.mock("./graphMaker", () => ({ buildGraph: mocks.buildGraph }));
vi.mock("./recorder", () => ({ createGraphRecorder: mocks.createGraphRecorder }));
vi.mock("./graphStorage", () => ({ saveRunGraph: mocks.saveRunGraph }));
vi.mock("./jevGate", () => ({ shouldRouteToGraphSystem: mocks.shouldRouteToGraphSystem }));
vi.mock("../chat/project/memory/projectMemoryOperationQueue", () => ({ runProjectMemoryExclusive: mocks.exclusive }));

import { persistAgentGraphTurn, prepareAgentGraphTurn } from "./agentTurn";

describe("global run-graph specialist turns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchRunGraphHints.mockResolvedValue("prior graph hint");
    mocks.shouldRouteToGraphSystem.mockResolvedValue(false);
    mocks.createGraphDigestTool.mockReturnValue({ runnable: { name: "get_relevant_run_graph_digest" } });
    mocks.createGraphToolLogTool.mockReturnValue({ runnable: { name: "get_run_graph_tool_log" } });
    mocks.cleanRunRecords.mockResolvedValue({ kept: [{ type: "run_start" }] });
    mocks.buildGraph.mockReturnValue({ runId: "run-focus" });
    mocks.saveRunGraph.mockResolvedValue({ key: "run-focus", embedded: true });
  });

  it("captures a turn but leaves final decision to useful calls when the gate declines", async () => {
    const recorder = { startRun: vi.fn(), finishRun: vi.fn(), getRecords: vi.fn(() => [{ type: "run_start" }]) };
    mocks.createGraphRecorder.mockReturnValue(recorder);
    const prepared = await prepareAgentGraphTurn({ agentKind: "focus", chatId: "chat-1", projectPath: "E:/project", userMessage: "Inspect the project structure" });
    expect(prepared.graphHint).toBe("prior graph hint");
    expect(prepared.digestTool?.name).toBe("get_relevant_run_graph_digest");
    expect(prepared.toolLogTool?.name).toBe("get_run_graph_tool_log");
    expect(prepared.recorder).toBe(recorder);
    expect(prepared.persistRequested).toBe(false);
    expect(mocks.searchRunGraphHints).toHaveBeenCalledWith("E:/project", "Inspect the project structure");
  });

  it("persists a substantive run", async () => {
    const recorder = {
      runId: "run-step", agentKind: "stepbystep", chatId: "chat-2",
      startRun: vi.fn(), recordModelCall: vi.fn(), recordToolCall: vi.fn(), finishRun: vi.fn(),
      getRecords: vi.fn(() => [{ type: "run_start" }]),
    };
    mocks.shouldRouteToGraphSystem.mockResolvedValue(true);
    mocks.createGraphRecorder.mockReturnValue(recorder);
    const prepared = await prepareAgentGraphTurn({ agentKind: "stepbystep", chatId: "chat-2", projectPath: "E:/project", userMessage: "Explore and implement" });
    await persistAgentGraphTurn(prepared, "Implemented", "[Step Workflow]");
    expect(recorder.startRun).toHaveBeenCalledWith("Explore and implement");
    expect(recorder.finishRun).toHaveBeenCalledWith("Implemented");
    expect(mocks.saveRunGraph).toHaveBeenCalledOnce();
  });

  it("still searches and exposes global graph tools without a project folder", async () => {
    const prepared = await prepareAgentGraphTurn({ agentKind: "focus", chatId: "chat-3", userMessage: "Explore files" });
    expect(prepared).toMatchObject({ projectPath: "", persistRequested: false, graphHint: "prior graph hint" });
    expect(prepared.digestTool?.name).toBe("get_relevant_run_graph_digest");
    expect(prepared.toolLogTool?.name).toBe("get_run_graph_tool_log");
    expect(mocks.searchRunGraphHints).toHaveBeenCalledWith(undefined, "Explore files");
  });

  it("records when the JEV gate fails", async () => {
    const recorder = { startRun: vi.fn() };
    mocks.shouldRouteToGraphSystem.mockRejectedValue(new Error("JEV unavailable"));
    mocks.createGraphRecorder.mockReturnValue(recorder);
    const prepared = await prepareAgentGraphTurn({ agentKind: "focus", chatId: "chat-4", userMessage: "Do useful work" });
    expect(prepared.recorder).toBe(recorder);
    expect(prepared.persistRequested).toBe(true);
    expect(recorder.startRun).toHaveBeenCalledWith("Do useful work");
  });

  it("saves when JEV says no but the run has actual tool calls", async () => {
    const recorder = {
      runId: "run-tool", agentKind: "focus", chatId: "chat-5", startRun: vi.fn(), finishRun: vi.fn(),
      getRecords: vi.fn(() => [{ type: "run_start" }, { type: "tool_call", id: "call-1", tool: "read_file", args: {}, result: "ok", status: "done" }]),
    };
    mocks.createGraphRecorder.mockReturnValue(recorder);
    const prepared = await prepareAgentGraphTurn({ agentKind: "focus", chatId: "chat-5", userMessage: "quick question" });
    mocks.cleanRunRecords.mockResolvedValue({ kept: [{ type: "run_start" }, { type: "tool_call", id: "call-1" }] });
    await persistAgentGraphTurn(prepared, "Done", "[Focus]");
    expect(mocks.saveRunGraph).toHaveBeenCalledOnce();
  });
});
