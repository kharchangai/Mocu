import { describe, expect, it, vi } from "vitest";

import {
  buildStepTranscript,
  fallbackStepMemory,
  summarizeStepHistory,
} from "./stepSummary";
import type { LogEntry } from "./types";

function entry(id: string, kind: LogEntry["kind"], data: unknown): LogEntry {
  return {
    id,
    workflowId: "wf",
    stepNumber: 1,
    time: new Date().toISOString(),
    kind,
    data,
  };
}

const history: LogEntry[] = [
  entry("u1", "user", { message: "Create the file" }),
  entry("c1", "tool_call", { callId: "call-1", name: "write_file", arguments: { path: "a.ts" } }),
  entry("r1", "tool_result", { callId: "call-1", name: "write_file", result: "written a.ts" }),
  entry("a1", "assistant", { reply: "Created a.ts" }),
  entry("u2", "user", { message: "Looks good, next" }),
  entry("a2", "assistant", { reply: "Moving on" }),
];

function modelReturning(content: string) {
  return { invoke: vi.fn(async () => ({ content })) };
}

describe("buildStepTranscript", () => {
  it("includes user, assistant, tool and error entries with log IDs for tools", () => {
    const text = buildStepTranscript([
      ...history,
      entry("e1", "error", { message: "boom" }),
    ]);

    expect(text).toContain("[user] Create the file");
    expect(text).toContain("[tool_call write_file logId=c1]");
    expect(text).toContain("[tool_result write_file logId=r1] written a.ts");
    expect(text).toContain("[assistant] Created a.ts");
    expect(text).toContain("[error] boom");
  });

  it("keeps head and tail and marks the omitted middle when over the budget", () => {
    const big = Array.from({ length: 50 }, (_, i) =>
      entry(`m${i}`, "assistant", { reply: `reply-${i} ${"x".repeat(2000)}` }),
    );
    big.push(entry("last", "assistant", { reply: "FINAL-ANSWER" }));

    const text = buildStepTranscript(big, 40_000);

    expect(text.length).toBeLessThanOrEqual(40_000 + 200);
    expect(text).toContain("omitted for length");
    expect(text).toContain("FINAL-ANSWER");
    expect(text).toContain("reply-0 ");
  });

  it("truncates long tool results to a preview", () => {
    const text = buildStepTranscript([
      entry("r9", "tool_result", { name: "t", result: "y".repeat(5000) }),
    ]);

    expect(text.length).toBeLessThan(1200);
    expect(text).toContain("logId=r9");
  });
});

describe("summarizeStepHistory", () => {
  it("returns a structured summary and drops evidence IDs that do not exist", async () => {
    const model = modelReturning(JSON.stringify({
      outcome: "a.ts was created.",
      decisions: ["Use TypeScript"],
      artifacts: ["a.ts: created"],
      openItems: [],
      evidenceLogIds: ["r1", "invented-id"],
    }));

    const memory = await summarizeStepHistory({
      model,
      entries: history,
      stepTitle: "Create file",
      stepGoal: "Create a.ts",
    });

    expect(memory.outcome).toBe("a.ts was created.");
    expect(memory.decisions).toEqual(["Use TypeScript"]);
    expect(memory.artifacts).toEqual(["a.ts: created"]);
    expect(memory.evidenceLogIds).toEqual(["r1"]);
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });

  it("accepts JSON wrapped in a code fence or extra text", async () => {
    const model = modelReturning(
      'Here you go:\n```json\n{"outcome":"Done.","decisions":[],"artifacts":[],"openItems":[],"evidenceLogIds":[]}\n```',
    );

    const memory = await summarizeStepHistory({
      model, entries: history, stepTitle: "S", stepGoal: "G",
    });

    expect(memory.outcome).toBe("Done.");
  });

  it("retries once on invalid output and then succeeds", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ content: "not json at all" })
      .mockResolvedValueOnce({ content: '{"outcome":"Recovered."}' });

    const memory = await summarizeStepHistory({
      model: { invoke }, entries: history, stepTitle: "S", stepGoal: "G",
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(memory.outcome).toBe("Recovered.");
    expect(memory.decisions).toEqual([]);
  });

  it("throws after all attempts fail, so the caller can fall back", async () => {
    const model = modelReturning("{}");

    await expect(
      summarizeStepHistory({ model, entries: history, stepTitle: "S", stepGoal: "G" }),
    ).rejects.toThrow();
    expect(model.invoke).toHaveBeenCalledTimes(2);
  });

  it("returns a fixed outcome without calling the model when there is no history", async () => {
    const model = modelReturning("{}");

    const memory = await summarizeStepHistory({
      model, entries: [], stepTitle: "S", stepGoal: "G",
    });

    expect(model.invoke).not.toHaveBeenCalled();
    expect(memory.outcome).not.toBe("");
  });
});

describe("fallbackStepMemory", () => {
  it("uses the last assistant reply as the outcome", () => {
    const memory = fallbackStepMemory(history);

    expect(memory.outcome).toBe("Moving on");
    expect(memory.evidenceLogIds).toEqual([]);
  });

  it("returns an empty outcome when there is no assistant reply", () => {
    expect(fallbackStepMemory([]).outcome).toBe("");
  });
});
