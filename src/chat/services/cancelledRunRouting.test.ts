import { beforeEach, describe, expect, it, vi } from "vitest";

const { getJevDecision } = vi.hoisted(() => ({ getJevDecision: vi.fn() }));
vi.mock("../../services/ai/tools/decision/Jev_model", () => ({ getJevDecision }));

import { routeMessageAfterCancelledRun } from "./cancelledRunRouting";
import type { CancelledRunData } from "./cancelledRun";

const cancelledRun: CancelledRunData = {
  userPrompt: "Implement the report generator",
  partialAnswer: "The parser is complete.",
  tools: [{ name: "terminal_executor", status: "done", input: "npm test" }],
  createdAt: "2026-11-04T00:00:00.000Z",
};

describe("routeMessageAfterCancelledRun", () => {
  beforeEach(() => getJevDecision.mockReset());

  it("routes an additive follow-up to the cancelled task", async () => {
    getJevDecision.mockResolvedValue({ answers: { continue_cancelled_task: { noul: 0.91 } } });
    await expect(routeMessageAfterCancelledRun({
      cancelledRun,
      newUserMessage: "Also add a CSV export.",
    })).resolves.toBe("continue_cancelled_task");
    expect(getJevDecision).toHaveBeenCalledWith(expect.objectContaining({
      state: expect.objectContaining({
        cancelled_task: expect.objectContaining({ original_request: cancelledRun.userPrompt }),
        new_user_message: "Also add a CSV export.",
      }),
    }));
  });

  it("routes an unrelated message to a fresh task", async () => {
    getJevDecision.mockResolvedValue({ answers: { continue_cancelled_task: { noul: 0.08 } } });
    await expect(routeMessageAfterCancelledRun({
      cancelledRun,
      newUserMessage: "What's the weather in Tokyo?",
    })).resolves.toBe("start_new_task");
  });

  it("fails safe on missing or ambiguous Decision answers", async () => {
    getJevDecision.mockResolvedValueOnce({ answers: {} });
    await expect(routeMessageAfterCancelledRun({ cancelledRun, newUserMessage: "Continue" }))
      .resolves.toBe("start_new_task");
    getJevDecision.mockRejectedValueOnce(new Error("Decision API unavailable"));
    await expect(routeMessageAfterCancelledRun({ cancelledRun, newUserMessage: "Continue" }))
      .rejects.toThrow("Decision API unavailable");
  });
});