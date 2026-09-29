import { AIMessageChunk } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

import { StepExecutor } from "./StepExecutor";
import type { WorkflowState } from "./types";
import type { WorkflowStore } from "./workflowStore";

vi.mock("../../../chat/docs", () => ({
  buildDocsContextPrompt: vi.fn(async () => ""),
}));

describe("StepExecutor tool rounds", () => {
  it("continues beyond ten tool rounds until the model finishes", async () => {
    const state: WorkflowState = {
      id: "workflow-test",
      chatId: "chat-test",
      plan: {
        final_goal: "Complete the requested task",
        steps: [{
          step_number: 1,
          title: "Complete the task",
          summary: "",
          goal: "Complete all requested work",
          tips: [],
        }],
      },
      currentStepIndex: 0,
      status: "active",
      memories: {},
      recentTurns: [],
    };

    const store = {
      load: vi.fn(async () => state),
      save: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ id: "log", workflowId: state.id })),
      readStepHistory: vi.fn(async () => []),
    } as unknown as WorkflowStore;

    let modelCalls = 0;
    const modelWithTools = {
      async *stream() {
        modelCalls += 1;

        if (modelCalls <= 11) {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{
              id: `tool-call-${modelCalls}`,
              name: "test_tool",
              args: {},
              type: "tool_call",
            }],
          });
          return;
        }

        yield new AIMessageChunk({ content: "The goal is complete." });
      },
    };
    const llm = {
      bindTools: vi.fn(() => modelWithTools),
    } as unknown as ChatOpenAI;

    const tool = {
      name: "test_tool",
      description: "A test tool",
      invoke: vi.fn(async () => "done"),
    };

    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => llm,
      buildSummaryLlm: async () => llm,
    });

    const result = await executor.send(
      state.id,
      { message: "Complete the task" },
      { tools: [tool] },
    );

    expect(tool.invoke).toHaveBeenCalledTimes(11);
    expect(modelCalls).toBe(12);
    expect(result.reply).toBe("The goal is complete.");
    expect(result.status).toBe("active");
  });

  it("retries a transient network failure and recovers", async () => {
    const state: WorkflowState = {
      id: "workflow-network-retry-test",
      chatId: "chat-network-retry-test",
      plan: {
        final_goal: "Complete the requested task",
        steps: [{
          step_number: 1,
          title: "Complete the task",
          summary: "",
          goal: "Complete all requested work",
          tips: [],
        }],
      },
      currentStepIndex: 0,
      status: "active",
      memories: {},
      recentTurns: [],
    };
    const store = {
      load: vi.fn(async () => state),
      save: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ id: "log", workflowId: state.id })),
      readStepHistory: vi.fn(async () => []),
    } as unknown as WorkflowStore;

    let modelCalls = 0;
    const modelWithTools = {
      async *stream() {
        modelCalls += 1;
        if (modelCalls === 1) {
          throw new TypeError("network error");
        }
        yield new AIMessageChunk({ content: "Recovered and completed." });
      },
    };
    const llm = {
      bindTools: vi.fn(() => modelWithTools),
    } as unknown as ChatOpenAI;
    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => llm,
      buildSummaryLlm: async () => llm,
    });

    const result = await executor.send(
      state.id,
      { message: "Complete the task" },
      { tools: [] },
    );

    expect(modelCalls).toBe(2);
    expect(result.reply).toBe("Recovered and completed.");
  });

  it("retries printed tool markup and continues when the retry uses a real tool call", async () => {
    const state: WorkflowState = {
      id: "workflow-successful-retry-test",
      chatId: "chat-successful-retry-test",
      plan: {
        final_goal: "Complete the requested task",
        steps: [{
          step_number: 1,
          title: "Complete the task",
          summary: "",
          goal: "Complete all requested work",
          tips: [],
        }],
      },
      currentStepIndex: 0,
      status: "active",
      memories: {},
      recentTurns: [],
    };
    const store = {
      load: vi.fn(async () => state),
      save: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ id: "log", workflowId: state.id })),
      readStepHistory: vi.fn(async () => []),
    } as unknown as WorkflowStore;

    let modelCalls = 0;
    let retryMessages: unknown[] = [];
    const modelWithTools = {
      async *stream(messages: unknown[]) {
        modelCalls += 1;
        if (modelCalls === 2) retryMessages = messages;

        if (modelCalls === 1) {
          yield new AIMessageChunk({
            content: "I'll read the file: <tool_call><function=read_file><parameter=path>src/file.ts</parameter></function></tool_call>",
          });
        } else if (modelCalls === 2) {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{
              id: "real-tool-call",
              name: "test_tool",
              args: {},
              type: "tool_call",
            }],
          });
        } else {
          yield new AIMessageChunk({ content: "The requested work is complete." });
        }
      },
    };
    const llm = {
      bindTools: vi.fn(() => modelWithTools),
    } as unknown as ChatOpenAI;
    const tool = {
      name: "test_tool",
      description: "A test tool",
      invoke: vi.fn(async () => "done"),
    };
    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => llm,
      buildSummaryLlm: async () => llm,
    });

    const result = await executor.send(
      state.id,
      { message: "Read the file" },
      { tools: [tool] },
    );

    expect(modelCalls).toBe(3);
    expect(tool.invoke).toHaveBeenCalledOnce();
    expect(JSON.stringify(retryMessages)).toContain("native function calling");
    expect(result.reply).toBe("The requested work is complete.");
  });

  it("retries printed tool markup, then returns a UI failure marker if it repeats", async () => {
    const state: WorkflowState = {
      id: "workflow-recovery-test",
      chatId: "chat-recovery-test",
      plan: {
        final_goal: "Complete the requested task",
        steps: [{
          step_number: 1,
          title: "Complete the task",
          summary: "",
          goal: "Complete all requested work",
          tips: [],
        }],
      },
      currentStepIndex: 0,
      status: "active",
      memories: {},
      recentTurns: [],
    };
    const store = {
      load: vi.fn(async () => state),
      save: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ id: "log", workflowId: state.id })),
      readStepHistory: vi.fn(async () => []),
    } as unknown as WorkflowStore;

    let modelCalls = 0;
    let retryMessages: unknown[] = [];
    const printedToolCall =
      "I'll read the file now: <tool_call><function=read_file><parameter=path>src/file.ts</parameter></function></tool_call>";
    const modelWithTools = {
      async *stream(messages: unknown[]) {
        modelCalls += 1;
        if (modelCalls === 2) retryMessages = messages;
        yield new AIMessageChunk({ content: printedToolCall });
      },
    };
    const llm = {
      bindTools: vi.fn(() => modelWithTools),
    } as unknown as ChatOpenAI;
    const executor = new StepExecutor(store, {
      buildTurnLlm: async () => llm,
      buildSummaryLlm: async () => llm,
    });

    const result = await executor.send(
      state.id,
      { message: "Read the file" },
      { tools: [] },
    );

    expect(modelCalls).toBe(2);
    expect(JSON.stringify(retryMessages)).toContain("native function calling");
    expect(result.reply).toContain("MOCU_STEP_TOOL_CALL_FAILURE_V1");
    expect(result.reply).not.toContain("<tool_call>");
    expect(result.status).toBe("active");
  });
});
