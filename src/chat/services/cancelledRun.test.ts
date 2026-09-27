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

  it("returns null for corrupted checkpoints", () => {
    expect(
      parseCancelledRunMessage(`${CANCELLED_RUN_MARKER} not json`),
    ).toBeNull();
  });
});