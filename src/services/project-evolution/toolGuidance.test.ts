import { describe, expect, it, vi } from "vitest";
import { findSimilarEpisodes, guideToolCall, type ToolRequest } from "./toolGuidance";
import type { StoredEpisodeRow } from "./episodeStore";

const ep = (over: Partial<StoredEpisodeRow> & Pick<StoredEpisodeRow, "callId" | "tool" | "step" | "runId">): StoredEpisodeRow => ({
  id: over.callId.length,
  createdAt: 0,
  ok: true,
  ...over,
});

const request: ToolRequest = {
  phase: "request",
  tool: "terminal_executor",
  args: { command: "npm test" },
  step: 5,
  callId: "new_call",
};

describe("findSimilarEpisodes", () => {
  it("ranks only the exact tool name, globally across project metadata", () => {
    const episodes = [
      ep({ callId: "same", tool: "terminal_executor", step: 1, runId: "r1", project: "E:\\one", args: { command: "npm test" } }),
      ep({ callId: "other", tool: "find_file", step: 1, runId: "r2", project: "E:\\two", args: { command: "npm test" } }),
    ];
    expect(findSimilarEpisodes(request, episodes).map((item) => item.callId)).toEqual(["same"]);
  });

  it("does not truncate large argument values in the candidate document", () => {
    const large = "x".repeat(2000);
    const episode = ep({ callId: "large", tool: "terminal_executor", step: 1, runId: "r", args: { command: large } });
    expect(findSimilarEpisodes({ ...request, args: { command: large } }, [episode])).toEqual([episode]);
  });
});

describe("guideToolCall", () => {
  const matchedWrong = ep({ callId: "wrong_1", tool: "terminal_executor", step: 2, runId: "run1", args: { command: "npm test" }, ok: false, error: "WRONG RESULT" });
  const fix = ep({ callId: "fix_1", tool: "terminal_executor", step: 3, runId: "run1", args: { command: "npm run test:ci" }, ok: true, result: "RIGHT RESULT" });

  it("returns no guidance when no global episodes exist", async () => {
    const result = await guideToolCall(request, { listEpisodes: async () => [] });
    expect(result.reason).toBe("no_episodes");
    expect(result.guidance).toBeNull();
  });

  it("uses Jev's {type: noul, noul: probability} response format", async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ same_job_0: { type: "noul", noul: 0.97 } })
      .mockResolvedValueOnce({ answers: { fixes_error: { type: "noul", noul: 0.97 } } });
    const result = await guideToolCall(request, {
      listEpisodes: async () => [matchedWrong],
      listRun: async () => [fix],
      decide: decide as never,
    });
    expect(result.reason).toBe("guidance_ready");
    expect(result.guidance).toContain("RIGHT RESULT");
  });

  it("sends all arguments and requests global exact-tool retrieval", async () => {
    const fullValue = "a".repeat(2500);
    const hugeRequest = { ...request, args: { command: fullValue, nested: { untouched: true } } };
    const listEpisodes = vi.fn(async () => [matchedWrong]);
    const decide = vi.fn(async ({ state }: { state: unknown }) => {
      const stateObj = state as { new_tool_call: { args: { command: string; nested: { untouched: boolean } } } };
      expect(stateObj.new_tool_call.args.command).toBe(fullValue);
      expect(stateObj.new_tool_call.args.nested.untouched).toBe(true);
      return { answers: { same_job_0: { type: "noul", noul: 0 } } };
    });
    await guideToolCall(hugeRequest, { listEpisodes, decide: decide as never });
    expect(listEpisodes).toHaveBeenCalledWith({ tool: "terminal_executor", limit: 1000 });
  });

  it("does not apply one candidate's probability to another candidate", async () => {
    const wrongA = ep({ callId: "wrong_a", tool: "terminal_executor", step: 1, runId: "runA", args: { command: "npm install" }, ok: false, error: "A failed" });
    const wrongB = ep({ callId: "wrong_b", tool: "terminal_executor", step: 1, runId: "runB", args: { command: "npm test" }, ok: false, error: "B failed" });
    const fixB = ep({ callId: "fix_b", tool: "terminal_executor", step: 2, runId: "runB", args: { command: "npm run test:ci" }, ok: true, result: "B fixed" });
    const listRun = vi.fn(async (runId: string) => runId === "runB" ? [fixB] : []);
    const decide = vi.fn(async ({ state, questions }: { state: unknown; questions: Record<string, unknown> }) => {
      const stateObj = state as { past_tool_calls?: Record<string, { args: { command: string } }>; earlier_failed_call?: unknown };
      if (stateObj.earlier_failed_call) return { fixes_error: { type: "noul", noul: 0.95 } };
      const answers = Object.fromEntries(Object.keys(questions).map((key, index) => [
        key,
        { type: "noul", noul: stateObj.past_tool_calls?.[`candidate_${index}`]?.args.command === "npm test" ? 0.96 : 0.1 },
      ]));
      return { answers };
    });
    const result = await guideToolCall(request, {
      listEpisodes: async () => [wrongA, wrongB],
      listRun,
      decide: decide as never,
      maxCandidates: 2,
    });
    expect(result.reason).toBe("guidance_ready");
    expect(result.matchedEpisode?.runId).toBe("runB");
  });

  it("checks up to 20 candidates in one Decision request while keeping answers tied to their candidates", async () => {
    const episodes = Array.from({ length: 20 }, (_, index) => ep({
      callId: `candidate_${index}`,
      tool: "terminal_executor",
      step: index + 1,
      runId: `run_${index}`,
      args: { command: index === 19 ? "npm test" : `unrelated task ${index}` },
      ok: true,
    }));
    const decide = vi.fn(async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: Object.fromEntries(Object.keys(questions).map((key, index) => [
        key,
        { type: "noul", noul: index === 19 ? 0.96 : 0.05 },
      ])),
    }));

    await guideToolCall(request, {
      listEpisodes: async () => episodes,
      decide: decide as never,
      maxCandidates: 20,
    });

    expect(decide).toHaveBeenCalledTimes(1);
    expect(Object.keys(decide.mock.calls[0][0].questions)).toHaveLength(20);
  });

  it("does not reject valid approaches; guidance is advisory after verified recovery", async () => {
    const decide = vi.fn()
      .mockResolvedValueOnce({ same_job_0: { type: "noul", noul: 0.98 } })
      .mockResolvedValueOnce({ answers: { fixes_error: { type: "noul", noul: 0.1 } } });
    const result = await guideToolCall(request, {
      listEpisodes: async () => [matchedWrong],
      listRun: async () => [fix],
      decide: decide as never,
    });
    expect(result.reason).toBe("no_correction_found");
    expect(result.guidance).toBeNull();
  });
});
