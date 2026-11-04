// src/chat/services/cancelledRun.test.ts
import { describe, expect, it } from "vitest";

import {
  CANCELLED_RUN_MARKER,
  buildCancelledRunMessage,
  parseCancelledRunMessage,
} from "./cancelledRun";

import type { AgentToolActivity } from "./toolActivity";

const activity = (
  overrides: Partial<AgentToolActivity> = {},
): AgentToolActivity => ({
  id: `tool-${Math.random()}`,
  tool: "terminal_executor",
  status: "done",
  ...overrides,
});

describe("cancelled run checkpoints", () => {
  it("round-trips the partial answer and tool work", () => {
    const content = buildCancelledRunMessage({
      userPrompt: "refactor the login screen",
      partialAnswer: "I started by reading the component…",
      activities: [
        activity({ args: { command: "ls -la" } }),
        activity({ status: "running", tool: "edit_file" }),
        activity({ kind: "thought", text: "thinking out loud" }),
      ],
    });

    expect(content.startsWith(CANCELLED_RUN_MARKER)).toBe(true);

    const parsed = parseCancelledRunMessage(content);

    expect(parsed).not.toBeNull();
    expect(parsed?.userPrompt).toBe("refactor the login screen");
    expect(parsed?.partialAnswer).toBe(
      "I started by reading the component…",
    );
    /*
     * Thoughts and notes are not tool work: only real tool calls are
     * summarised, and an interrupted call is kept as 'cancelled'.
     */
    expect(parsed?.tools).toEqual([
      { name: "terminal_executor", status: "done", input: "ls -la" },
      { name: "edit_file", status: "cancelled", input: "" },
    ]);
    expect(parsed?.createdAt).toBeTruthy();
  });

  it("keeps a readable summary in the message body", () => {
    const content = buildCancelledRunMessage({
      userPrompt: "do the thing",
      partialAnswer: "",
      activities: [],
    });

    const [, summary] = content.split("\n");

    expect(summary).toContain("cancelled by the user");
    expect(parseCancelledRunMessage("an ordinary assistant reply")).toBeNull();
  });

  it("survives an oversized partial answer", () => {
    const content = buildCancelledRunMessage({
      userPrompt: "long job",
      partialAnswer: "x".repeat(50_000),
      activities: Array.from({ length: 5 }, (_, index) =>
        activity({ id: `tool-${index}` }),
      ),
    });

    expect(content.length).toBeLessThan(20_000);
    expect(parseCancelledRunMessage(content)?.tools).toHaveLength(5);
  });

  it("round-trips the exact model-run snapshot needed for resuming", () => {
    const resumeSnapshot = {
      version: 1 as const,
      projectPath: "E:/demo",
      originalUserPrompt: "finish the feature",
      latestUserPrompt: "finish the feature",
      modelId: "test-model",
      gatewayBaseUrl: "https://gateway.example/v1",
      messages: [
        { type: "system", data: { content: "stable system prompt", role: undefined, name: undefined, tool_call_id: undefined } },
        { type: "human", data: { content: "finish the feature", role: undefined, name: undefined, tool_call_id: undefined } },
        { type: "tool", data: { content: "created the file", role: undefined, name: "terminal_executor", tool_call_id: "tool-call-1" } },
      ],
      toolDefinitions: [{ type: "function", function: { name: "terminal_executor", parameters: {} } }],
      configurable: {
        selectedSkills: ["coding"],
        selectedExtensions: [],
        selectedMcpServers: [],
        selectedAgent: null,
        selectedModel: "test-model",
        reasoningEffort: "high",
        projectDescription: "demo project",
      },
    };
    const content = buildCancelledRunMessage({
      userPrompt: "finish the feature",
      partialAnswer: "",
      activities: [],
      resumeSnapshot,
    });

    expect(parseCancelledRunMessage(content)?.resumeSnapshot).toEqual(resumeSnapshot);
  });

  it("drops an oversized resume payload rather than writing an unloadable checkpoint", () => {
    const resumeSnapshot = {
      version: 1 as const,
      projectPath: "E:/demo",
      originalUserPrompt: "continue",
      latestUserPrompt: "continue",
      modelId: "test-model",
      gatewayBaseUrl: "https://gateway.example/v1",
      messages: [],
      toolDefinitions: [],
      configurable: {
        selectedSkills: [],
        selectedExtensions: [],
        selectedMcpServers: [],
        selectedAgent: null,
        selectedModel: "test-model",
        reasoningEffort: null,
        projectDescription: "x".repeat(1_600_000),
      },
    };
    const content = buildCancelledRunMessage({
      userPrompt: "continue",
      partialAnswer: "",
      activities: [],
      resumeSnapshot,
    });

    expect(content.length).toBeLessThan(20_000);
    expect(parseCancelledRunMessage(content)?.resumeSnapshot).toBeUndefined();
  });

  it("returns null for corrupted checkpoints", () => {
    expect(
      parseCancelledRunMessage(`${CANCELLED_RUN_MARKER} not json`),
    ).toBeNull();
  });
});