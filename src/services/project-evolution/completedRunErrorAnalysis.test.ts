import { describe, expect, it, vi } from "vitest";
import { analyzeCompletedRunErrors } from "./completedRunErrorAnalysis";

vi.mock("../ai/llm", () => ({
  getAsyncLLM: vi.fn(async () => ({
    invoke: vi.fn(async () => ({ content: "For code changes, use terminal editing and inspect the diff." })),
  })),
}));
vi.mock("../ai/tools/decision/Jev_model", () => ({
  getJevDecision: vi.fn(async ({ questions, state }: { questions: Record<string, unknown>; state?: unknown }) => {
    const answers: Record<string, { noul: number }> = {};
    for (const key of Object.keys(questions)) {
      const failedCall = JSON.stringify(state ?? {});
      answers[key] = { noul: key === "failed_tool_call_caused_failure" ? (failedCall.includes("bad-command") ? 0.95 : 0) : key === "may_have_caused_failure" ? 0.95 : 0.9 };
    }
    return { answers };
  }),
}));
vi.mock("./episodeMemoryStore", () => ({
  getEpisodeMemoryLesson: vi.fn(async () => ({ id: 9, causes: [], failure: {}, instruction: "use terminal" })),
  saveEpisodeMemoryLesson: vi.fn(async (input: unknown) => ({ id: 11, ...(input as object), score: 50 })),
  updateEpisodeMemoryScore: vi.fn(async () => true),
}));

describe("analyzeCompletedRunErrors", () => {
  it("stores a generated lesson with all candidate causes and the failed action", async () => {
    const { saveEpisodeMemoryLesson } = await import("./episodeMemoryStore");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await analyzeCompletedRunErrors({
      userRequest: "Edit source file",
      runId: "run-test",
      completedWork: [
        { step: 1, callId: "a", tool: "write_file", args: { path: "src/a.py" }, ok: true, result: "saved" },
        { step: 3, callId: "b", tool: "edit_file", args: { path: "src/a.py" }, ok: false, error: "not applied" },
      ],
    });
    expect(saveEpisodeMemoryLesson).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-test",
      causes: [expect.objectContaining({ tool: "write_file" })],
      failure: expect.objectContaining({ tool: "edit_file", error: "not applied" }),
      instruction: "For code changes, use terminal editing and inspect the diff.",
    }));
    log.mockRestore(); warn.mockRestore(); error.mockRestore();
  });

  it("does not analyze earlier tools when the failed tool's own command caused the failure", async () => {
    const { saveEpisodeMemoryLesson } = await import("./episodeMemoryStore");
    const { getJevDecision } = await import("../ai/tools/decision/Jev_model");
    vi.mocked(getJevDecision).mockClear();
    vi.mocked(saveEpisodeMemoryLesson).mockClear();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await analyzeCompletedRunErrors({
      userRequest: "This must not affect error attribution",
      runId: "run-test-self-caused",
      completedWork: [
        { step: 1, callId: "a", tool: "terminal_executor", args: { command: "bad-command" }, ok: false, error: "command not found" },
      ],
    });
    expect(getJevDecision).toHaveBeenCalledTimes(1);
    expect(getJevDecision).toHaveBeenCalledWith(expect.objectContaining({
      state: { failed_tool_call: expect.objectContaining({ tool: "terminal_executor" }) },
    }));
    expect(saveEpisodeMemoryLesson).not.toHaveBeenCalled();
    log.mockRestore(); warn.mockRestore(); error.mockRestore();
  });

  it("scores only a comparable prevented outcome after the saved instruction was followed", async () => {
    const { updateEpisodeMemoryScore } = await import("./episodeMemoryStore");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await analyzeCompletedRunErrors({
      userRequest: "Repeat code edit",
      runId: "run-test",
      guidanceUses: [{ step: 1, callId: "shown", lessonIds: [9] }],
      completedWork: [
        { step: 1, callId: "shown", tool: "edit_file", ok: false, error: "not run", args: {} },
        { step: 2, callId: "later", tool: "terminal_executor", ok: true, result: "diff clean", args: { command: "apply source patch" } },
      ],
    });
    expect(updateEpisodeMemoryScore).toHaveBeenCalledWith(9, "prevented");
    log.mockRestore(); warn.mockRestore(); error.mockRestore();
  });
});
