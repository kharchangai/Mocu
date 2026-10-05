import { AIMessageChunk } from "@langchain/core/messages";
import type { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it, vi } from "vitest";
import { FocusExecutor } from "./FocusExecutor";
import type { FocusState } from "./types";
import type { FocusStore } from "./focusStore";

vi.mock("../../../chat/docs", () => ({ buildDocsContextPrompt: async () => "" }));

describe("Focus filesystem recovery", () => {
  it("preserves the error, skips the duplicate and allows terminal fallback", async () => {
    const state: FocusState = {
      id: "focus-recovery", chatId: "chat-recovery", createdAt: "2026-10-05T00:00:00Z",
      goal: "Fix code", currentSectionNumber: 1, status: "active", memories: {},
    };
    const store = {
      load: vi.fn(async () => state), save: vi.fn(async () => undefined),
      append: vi.fn(async () => ({ id: "log", focusId: state.id })),
      readSectionHistory: vi.fn(async () => []),
    } as unknown as FocusStore;
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
    const edit = { name: "edit_file", description: "edit", invoke: vi.fn(async () => "Error: invalid range") };
    const terminal = { name: "terminal_executor", description: "shell", invoke: vi.fn(async () => "Repaired and verified") };
    const executor = new FocusExecutor(store, { buildTurnLlm: async () => llm, buildSummaryLlm: async () => llm });
    const result = await executor.send(state.id, "Fix code", { tools: [edit, terminal] });
    expect(edit.invoke).toHaveBeenCalledOnce();
    expect(terminal.invoke).toHaveBeenCalledOnce();
    expect(captured[1]).toContain("Error: invalid range");
    expect(captured[2]).toContain("NOT executed again");
    expect(result.reply).toBe("Fixed and verified.");
    expect(result.status).toBe("active");
  });
});
