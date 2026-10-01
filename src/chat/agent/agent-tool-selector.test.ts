import { beforeEach, describe, expect, it, vi } from "vitest";

const { getJevDecision } = vi.hoisted(() => ({
  getJevDecision: vi.fn(),
}));

vi.mock("../../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision,
}));

import {
  AGENT_TOOL_CATALOG,
} from "./agent-tool-catalog";
import {
  probabilityOfToolRelevance,
  selectAgentTools,
} from "./agent-tool-selector";

describe("agent-tool-selector", () => {
  beforeEach(() => {
    getJevDecision.mockReset();
  });

  it("sends the natural-language request and full tool catalog to Jev, then returns exact matching names", async () => {
    getJevDecision.mockResolvedValue({
      answers: {
        terminal_executor: { noul: 0.94 },
        perplexity_search: { noul: 0.08 },
        load_skill: { noul: 0.4 },
        schedule_action: { noul: 0.01 },
      },
    });

    const selected = await selectAgentTools(
      "Build an agent that inspects a project, runs tests and fixes build failures.",
    );

    expect(getJevDecision).toHaveBeenCalledWith(expect.objectContaining({
      state: {
        agent_creation_request:
          "Build an agent that inspects a project, runs tests and fixes build failures.",
        available_tools: AGENT_TOOL_CATALOG,
      },
      questions: expect.objectContaining({
        terminal_executor: expect.objectContaining({ type: "noul" }),
        perplexity_search: expect.objectContaining({ type: "noul" }),
      }),
    }));
    expect(selected).toEqual([{ name: "terminal_executor", relevance: 0.94 }]);
  });

  it("honors explicitly requested tool categories in Persian even when Jev scores them low", async () => {
    getJevDecision.mockResolvedValue({
      answers: Object.fromEntries(
        AGENT_TOOL_CATALOG.map(({ name }) => [name, { noul: 0.01 }]),
      ),
    });

    const selected = await selectAgentTools(
      "یک ایجنت با ابزار ترمینال و فایل سیستم و داکویمنت و نوت بساز",
    );

    expect(selected.map(({ name }) => name)).toEqual([
      "terminal_executor",
      "filesystem",
      "documents",
      "notes",
    ]);
  });

  it("uses explicitly named tools if Jev is unavailable", async () => {
    getJevDecision.mockRejectedValue(new Error("Decision API unavailable"));

    const selected = await selectAgentTools("Create an agent with terminal and filesystem tools.");

    expect(selected.map(({ name }) => name)).toEqual([
      "terminal_executor",
      "filesystem",
    ]);
  });

  it("accepts supported Jev answer shapes and clamps probabilities", () => {
    expect(probabilityOfToolRelevance({ noul: 1.4 })).toBe(1);
    expect(probabilityOfToolRelevance({ probabilities: { true: 0.72 } })).toBe(0.72);
    expect(probabilityOfToolRelevance({ value: true })).toBe(1);
    expect(probabilityOfToolRelevance(undefined)).toBe(0);
  });

  it("rejects an empty request and forwards the cancellation signal", async () => {
    await expect(selectAgentTools("  ")).rejects.toThrow("non-empty");

    const controller = new AbortController();
    getJevDecision.mockResolvedValue({ answers: {} });
    await selectAgentTools("Create a helper agent", { signal: controller.signal });
    expect(getJevDecision).toHaveBeenCalledWith(expect.objectContaining({
      signal: controller.signal,
    }));
  });
});
