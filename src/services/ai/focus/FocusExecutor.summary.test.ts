import { AIMessageChunk } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

import { FocusExecutor } from "./FocusExecutor";
import type { FocusLogEntry, FocusState } from "./types";
import type { FocusStore } from "./focusStore";

vi.mock("../../../chat/docs", () => ({ buildDocsContextPrompt: async () => "" }));

const FOCUS_ID = "focus-summary";

function entry(id: string, kind: FocusLogEntry["kind"], data: unknown, sectionNumber = 1): FocusLogEntry {
  return {
    id,
    focusId: FOCUS_ID,
    sectionNumber,
    time: new Date(2024, 0, 1, 0, 0, sectionNumber).toISOString(),
    kind,
    data,
  };
}

/** In-memory section history shared by append() and readSectionHistory(). */
function createStore(state: FocusState) {
  const logs: FocusLogEntry[] = [];
  const store = {
    load: vi.fn(async () => state),
    save: vi.fn(async () => undefined),
    append: vi.fn(async (_id: string, sectionNumber: number, kind: FocusLogEntry["kind"], data: unknown) => {
      const item = entry(`log-${logs.length + 1}`, kind, data, sectionNumber);
      logs.push(item);
      return item;
    }),
    readSectionHistory: vi.fn(async (_id: string, sectionNumber: number) =>
      logs.filter((item) => item.sectionNumber === sectionNumber),
    ),
    setChatFocus: vi.fn(async () => undefined),
    getChatFocus: vi.fn(async () => state.id),
  } as unknown as FocusStore;
  return { store, logs };
}

/**
 * One model object used for both the tool-calling turn and the plain
 * acknowledgement call. First call requests next_focus_section, the next
 * call answers with text.
 */
function advancingModel() {
  let calls = 0;
  const stream = async function* () {
    calls += 1;
    if (calls === 1) {
      yield new AIMessageChunk({
        content: "",
        tool_calls: [{ id: "next-1", name: "next_focus_section", args: {}, type: "tool_call" }],
      });
    } else {
      yield new AIMessageChunk({ content: "Moved on." });
    }
  };
  const model = { stream };
  return { ...model, bindTools: () => model } as unknown as ChatOpenAI;
}

function focusState(): FocusState {
  return {
    id: FOCUS_ID,
    chatId: "chat-summary",
    createdAt: "2026-01-01T00:00:00Z",
    goal: "Build the feature",
    currentSectionNumber: 1,
    status: "active",
    memories: {},
  };
}

describe("Focus section summary on transition", () => {
  it("summarizes the whole section including milestones and stores structured memory", async () => {
    const state = focusState();
    const { store, logs } = createStore(state);
    const summarize = vi.fn(async (_messages: unknown[]) => ({
      content: JSON.stringify({
        outcome: "Feature built and checked.",
        decisions: ["Use zod"],
        artifacts: ["feature.ts: new file"],
        openItems: ["Run e2e tests"],
        evidenceLogIds: [],
      }),
    }));
    const executor = new FocusExecutor(store, {
      buildTurnLlm: async () => advancingModel(),
      buildSummaryLlm: async () => ({ invoke: summarize }) as unknown as ChatOpenAI,
    });

    // A milestone recorded earlier in the section must reach the summarizer.
    logs.push(entry("milestone-1", "milestone", { summary: "feature.ts created" }));

    const result = await executor.send(state.id, "Next please", { tools: [] });

    expect(result.advanced).toBe(true);
    expect(summarize).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(summarize.mock.calls[0]?.[0] ?? []);
    expect(prompt).toContain("feature.ts created");
    expect(state.memories["1"]).toMatchObject({
      summary: "Feature built and checked.",
      decisions: ["Use zod"],
      artifacts: ["feature.ts: new file"],
      openItems: ["Run e2e tests"],
    });
    expect(state.currentSectionNumber).toBe(2);
  });

  it("falls back to the last reply and still advances when the summarizer fails", async () => {
    const state = focusState();
    const { store } = createStore(state);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const model = advancingModel();
    const executor = new FocusExecutor(store, {
      buildTurnLlm: async () => model,
      buildSummaryLlm: async () => ({
        invoke: vi.fn(async () => {
          throw new Error("summarizer down");
        }),
      }) as unknown as ChatOpenAI,
    });

    const result = await executor.send(state.id, "Next please", { tools: [] });

    expect(result.advanced).toBe(true);
    expect(state.currentSectionNumber).toBe(2);
    expect(state.memories["1"].summary).toBe("Moved on.");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});