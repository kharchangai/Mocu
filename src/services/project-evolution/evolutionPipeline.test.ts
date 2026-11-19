import { describe, expect, it, vi } from "vitest";
import { handActionToWorldModel } from "./evolutionPipeline";
import { createEpisodeRunRecorder } from "./episodeRecorder";

describe("world model handoff", () => {
  it("labels the request and logs the matching response beside it", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = { phase: "request" as const, tool: "terminal_executor", args: { command: "Get-Location" }, step: 1, callId: "call_abc" };
    const response = { phase: "response" as const, tool: "terminal_executor", step: 1, callId: "call_abc", ok: true, result: "E:\\mocube\\mocu" };

    await handActionToWorldModel(request);
    await handActionToWorldModel(response);

    expect(spy).toHaveBeenNthCalledWith(1, "[World Model] request", request);
    expect(spy).toHaveBeenNthCalledWith(2, "[World Model] response", {
      callId: "call_abc",
      request,
      response,
    });
    spy.mockRestore();
  });

  it("buffers one episode per completed step when a recorder is passed", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const recorder = createEpisodeRunRecorder({ projectPath: "E:\\demo" });
    await handActionToWorldModel({ phase: "request", tool: "read_file", args: { path: "a.ts" }, step: 2, callId: "call_1" }, recorder);
    expect(recorder.size()).toBe(0); // requests alone are not episodes yet

    await handActionToWorldModel({ phase: "response", tool: "read_file", step: 2, callId: "call_1", ok: true, result: "line 1" }, recorder);
    expect(recorder.size()).toBe(1);
    spy.mockRestore();
  });

  it("flush buffers every completed episode of the run as one batch", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const recorder = createEpisodeRunRecorder({ projectPath: "E:\\demo" });
    await handActionToWorldModel({ phase: "request", tool: "read_file", args: { path: "a.ts" }, step: 1, callId: "call_1" }, recorder);
    await handActionToWorldModel({ phase: "response", tool: "read_file", step: 1, callId: "call_1", ok: false, error: "not found" }, recorder);
    await handActionToWorldModel({ phase: "request", tool: "find_file", args: { root: "E:\\demo" }, step: 2, callId: "call_2" }, recorder);
    await handActionToWorldModel({ phase: "response", tool: "find_file", step: 2, callId: "call_2", ok: true, result: "a.ts" }, recorder);

    const flushSpy = vi.spyOn(await import("./episodeStore"), "saveEpisodeRecords")
      .mockResolvedValue({ saved: 2, skipped: 0 });
    const result = await recorder.flush();
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy.mock.calls[0][0]).toHaveLength(2);
    expect(result).toEqual({ saved: 2, skipped: 0 });
    expect(recorder.size()).toBe(0);
    flushSpy.mockRestore();
    spy.mockRestore();
  });
});