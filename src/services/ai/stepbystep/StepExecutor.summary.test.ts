import { AIMessageChunk } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

import { StepExecutor } from "./StepExecutor";
import type { LogEntry, StepMemory, WorkflowState } from "./types";
import type { WorkflowStore } from "./workflowStore";

vi.mock("../../../chat/docs", () => ({
  buildDocsContextPrompt: vi.fn(async () => ""),
}));

/** In-memory store: append() and readStepHistory() share one list. */
function createMemoryStore(state: WorkflowState) {
  const logs: LogEntry[] = [];
  const memories: Record<number, StepMemory> = {};
  let counter = 0;

  const store = {
    load: vi.fn(async () => state),
    save: vi.fn(async () => undefined),
    append: vi.fn(async (_id: string, stepNumber: number, kind: LogEntry["kind"], data: unknown) => {
      counter += 1;
      const entry: LogEntry = {
        id: `log-${counter}`,
        workflowId: state.id,
        stepNumber,
        time: new Date(2024, 0, 1, 0, 0, counter).toISOString(),
        kind,
        data,
      };
      logs.push(entry);
      return entry;
    }),
    readStepHistory: vi.fn(async (_id: string, stepNumber: number) =>
      logs.filter((entry) => entry.stepNumber === stepNumber),
    ),
    saveStepMemory: vi.fn(async (_id: string, stepNumber: number, memory: StepMemory) => {
      memories[stepNumber] = memory;
    }),
    setChatWorkflow: vi.fn(async () => undefined),
  } as unknown as WorkflowStore;

  return { store, logs, memories };
}

function twoStepState(): WorkflowState {
  return {
    id: "wf-summary",
    chatId: "chat-summary",
    plan: {
      final_goal: "Build the feature",
      steps: [
        { step_number: 1, title: "Create file", summary: "", goal: "Create a.ts", tips: [] },
        { step_number: 2, title: "Test", summary: "", goal: "Test a.ts", tips: [] },
      ],
    },
    currentStepIndex: 0,
    status: "active",
    memories: {},
    recentTurns: [],
  };
}

/**
 * Model for the execution turn: first call requests move_to_next_step,
 * second call returns a short acknowledgement.
 */
function advancingModel() {
  let calls = 0;
  return {
    bindTools: vi.fn(() => ({
      async *stream() {
        calls += 1;
        if (calls === 1) {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{ id: "adv-1", name: "move_to_next_step", args: {}, type: "tool_call" }],
          });
        } else {
          yield new AIMessageChunk({ content: "Moved on." });
        }
      },
    })),
  } as unknown as ChatOpenAI;
}

describe("StepExecutor step summary on transition", () => {
  it("summarizes the full step history, including the turn that advanced", async () => {
    const state = twoStepState();
    const { store, memories } = createMemoryStore(state);
    const summaryInvoke = vi.fn(async (messages: unknown[]) => {
      const transcript = JSON.stringify(messages);
      expect(transcript).toContain("Create a.ts with the helper");
      return {
        content: JSON.stringify({
          outcome: "a.ts was created with the helper.",
          decisions: ["Use helper"],
          artifacts: ["a.ts"],
          openItems: [],
          evidenceLogIds: [],
        }),
      };
    });
    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => advancingModel(),
      buildSummaryLlm: async () => ({ invoke: summaryInvoke }) as unknown as ChatOpenAI,
    });

    const result = await executor.send(
      state.id,
      { message: "Create a.ts with the helper, then move on" },
      { tools: [] },
    );

    expect(result.advanced).toBe(true);
    expect(summaryInvoke).toHaveBeenCalledTimes(1);
    expect(memories[1]).toMatchObject({
      outcome: "a.ts was created with the helper.",
      decisions: ["Use helper"],
      artifacts: ["a.ts"],
    });
    expect(state.currentStepIndex).toBe(1);
  });

  it("falls back to the last reply and still advances when the summarizer fails", async () => {
    const state = twoStepState();
    const { store, memories } = createMemoryStore(state);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => advancingModel(),
      buildSummaryLlm: async () => ({
        invoke: vi.fn(async () => {
          throw new Error("summarizer down");
        }),
      }) as unknown as ChatOpenAI,
    });

    const result = await executor.send(state.id, { message: "Move on" }, { tools: [] });

    expect(result.advanced).toBe(true);
    expect(state.currentStepIndex).toBe(1);
    expect(memories[1].outcome).toBe("Moved on.");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stores a fixed outcome and never calls the summarizer when the step has no history", async () => {
    const state = twoStepState();
    const { store, memories } = createMemoryStore(state);
    const summarizerInvoke = vi.fn();
    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => advancingModel(),
      buildSummaryLlm: async () => ({ invoke: summarizerInvoke }) as unknown as ChatOpenAI,
    });

    await executor.cancel(state.id);

    expect(summarizerInvoke).not.toHaveBeenCalled();
    expect(memories[1].outcome).not.toBe("");
    expect(state.status).toBe("cancelled");
  });
});
