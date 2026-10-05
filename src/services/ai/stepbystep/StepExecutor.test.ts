import { AIMessageChunk } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";

import { StepExecutor } from "./StepExecutor";
import type { WorkflowState } from "./types";
import type { WorkflowStore } from "./workflowStore";
/*
 * Docs context mock: hoisted so tests can assert what StepExecutor injects.
 * The default keeps prior behavior (empty hint → block omitted).
 */
const docsContextMock = vi.hoisted(() => ({
  buildDocsContextPrompt: vi.fn(async () => ""),
}));

vi.mock("../../../chat/docs", () => docsContextMock);

describe("StepExecutor tool rounds", () => {
  it("skips an identical failed edit, then continues using terminal fallback", async () => {
    const state: WorkflowState = {
      id: "workflow-file-recovery", chatId: "chat-file-recovery",
      plan: { final_goal: "Fix code", steps: [{ step_number: 1, title: "Fix", summary: "", goal: "Fix", tips: [] }] },
      currentStepIndex: 0, status: "active", memories: {}, recentTurns: [],
    };
    const store = {
      load: vi.fn(async () => state), save: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ id: "log", workflowId: state.id })),
      readStepHistory: vi.fn(async () => []),
    } as unknown as WorkflowStore;
    let rounds = 0;
    const captured: string[] = [];
    const llm = {
      bindTools: vi.fn(() => ({
        async *stream(messages: unknown[]) {
          captured.push(JSON.stringify(messages));
          rounds++;
          if (rounds <= 3) {
            yield new AIMessageChunk({ content: "", tool_calls: [{
              id: `call-${rounds}`, type: "tool_call",
              name: rounds <= 2 ? "edit_file" : "terminal_executor",
              args: rounds <= 2 ? { path: "E:\\project\\file.ts", edits: [] } : { command: "repair" },
            }] });
          } else yield new AIMessageChunk({ content: "Fixed and verified." });
        },
      })),
    } as unknown as ChatOpenAI;
    const edit = { name: "edit_file", description: "edit", invoke: vi.fn(async () => { throw new Error("edits must not be empty"); }) };
    const terminal = { name: "terminal_executor", description: "shell", invoke: vi.fn(async () => "Repaired and verified") };
    const executor = new StepExecutor(store, { buildTurnLlm: async () => llm, buildSummaryLlm: async () => llm });
    const result = await executor.send(state.id, { message: "Fix code" }, { tools: [edit, terminal] });
    expect(edit.invoke).toHaveBeenCalledOnce();
    expect(terminal.invoke).toHaveBeenCalledOnce();
    expect(captured[1]).toContain("edits must not be empty");
    expect(captured[2]).toContain("NOT executed again");
    expect(result.reply).toBe("Fixed and verified.");
  });
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
    // Doc context is requested with the actual user message.
    expect(docsContextMock.buildDocsContextPrompt).toHaveBeenCalledWith(
      "Complete the task",
    );
  });

  it("injects the doc reference block (metadata only) into the system prompt", async () => {
    const state: WorkflowState = {
      id: "workflow-doc-context-test",
      chatId: "chat-doc-context-test",
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

    const referenceBlock = [
      "SAVED DOCS (references only — metadata, never content; max 2):",
      '- file: "guide.md" | id: guide | title: Guide | description: A guide. | keywords: guide',
      "Read a doc only when needed with read_knowledge_doc(fileName). Links inside docs are descriptive leads: follow them by calling read_knowledge_doc with the linked file name yourself — their content is never included or fetched automatically.",
    ].join("\n");
    docsContextMock.buildDocsContextPrompt.mockResolvedValueOnce(referenceBlock);

    let capturedMessages: unknown[] = [];
    const modelWithTools = {
      async *stream(messages: unknown[]) {
        capturedMessages = messages;
        yield new AIMessageChunk({ content: "Done." });
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
      { message: "Use the guide" },
      { tools: [] },
    );

    const serialized = JSON.stringify(capturedMessages);
    // Reference + approved metadata + agent-read hint reach the prompt…
    expect(serialized).toContain("SAVED DOCS (references only");
    expect(serialized).toContain('file: \\"guide.md\\"');
    expect(serialized).toContain("title: Guide");
    expect(serialized).toContain("read_knowledge_doc");
    expect(serialized).toContain("descriptive leads");
    expect(result.reply).toBe("Done.");
    expect(docsContextMock.buildDocsContextPrompt).toHaveBeenCalledWith(
      "Use the guide",
    );
  });

  it("omits the doc block when the context search fails open (empty hint)", async () => {
    docsContextMock.buildDocsContextPrompt.mockResolvedValueOnce("");

    const state: WorkflowState = {
      id: "workflow-doc-context-empty-test",
      chatId: "chat-doc-context-empty-test",
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

    let capturedMessages: unknown[] = [];
    const modelWithTools = {
      async *stream(messages: unknown[]) {
        capturedMessages = messages;
        yield new AIMessageChunk({ content: "Done." });
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
      { message: "No docs here" },
      { tools: [] },
    );

    expect(JSON.stringify(capturedMessages)).not.toContain("SAVED DOCS");
    expect(result.reply).toBe("Done.");
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
