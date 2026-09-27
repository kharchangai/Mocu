// agent/specialist-memory.test.ts

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../chat/services/memoryActivity", () => ({
  dispatchMemorySaveActivity: vi.fn(),
}));
vi.mock("../../../chat/project/memory/storage/databaseManager", () => ({
  databaseManager: {},
}));
vi.mock("../../../chat/project/memory/projectMemoryOperationQueue", () => ({
  runProjectMemoryExclusive: (fn: () => unknown) => fn(),
}));
vi.mock("../../../chat/project/memory/saveProjectMemory", () => ({
  saveProjectMemory: vi.fn(),
}));

import {
  buildSpecialistHandoffText,
  createSpecialistMemoryTag,
  parseSpecialistHandoff,
  type SpecialistSectionMemoryInput,
} from "./specialist-memory";

const input: SpecialistSectionMemoryInput = {
  sessionType: "focus",
  sessionId: "focus.session:2026/09/26",
  sectionNumber: 3,
  goal: "Wire the payment provider\nand cover edge cases",
  summary: "Provider wired and verified.\nTests are green.",
  decisions: ["Use Stripe; keep PayPal later", "Mock clock in tests"],
  artifacts: ["src/pay/stripe.ts; src/pay/stripe.test.ts"],
  openItems: ["Retry policy for 429s"],
  projectPath: "E:/demo/project",
  chatId: "chat-1",
};

describe("specialist handoff memory format", () => {
  it("round-trips every field through the stored text", () => {
    const { userMessage, agentResponse } = buildSpecialistHandoffText(input);
    const tag = createSpecialistMemoryTag(input);
    expect(userMessage).toContain(`Memory tag: ${tag}`);

    const match = parseSpecialistHandoff(userMessage, agentResponse, "2026-09-26T10:00:00.000Z");
    expect(match).not.toBeNull();
    expect(match).toMatchObject({
      tag,
      sessionType: "focus",
      sessionId: "focus.session:2026/09/26",
      sectionNumber: 3,
      summary: "Provider wired and verified.\nTests are green.",
      decisions: ["Use Stripe; keep PayPal later", "Mock clock in tests"],
      artifacts: ["src/pay/stripe.ts; src/pay/stripe.test.ts"],
      openItems: ["Retry policy for 429s"],
    });
  });

  it("keeps list items that contain '; ' intact", () => {
    const { userMessage, agentResponse } = buildSpecialistHandoffText({
      ...input,
      sessionType: "step-by-step",
      decisions: ["a; b", "c"],
    });
    const match = parseSpecialistHandoff(userMessage, agentResponse, "2026-09-26T10:00:00.000Z");
    expect(match?.decisions).toEqual(["a; b", "c"]);
  });

  it("parses legacy '; ' separated lists for older handoffs", () => {
    const tag = createSpecialistMemoryTag(input);
    const legacy = [
      "Persistent specialist-session handoff for the main project agent.",
      `Memory tag: ${tag}`,
      "Session type: focus",
      `Session ID: ${input.sessionId}`,
      `Section/step number: ${input.sectionNumber}`,
      "Goal: legacy goal",
      "Summary: legacy summary",
      "Decisions: one; two",
      "Artifacts: a.ts",
      "Open items:",
    ].join("\n");

    const match = parseSpecialistHandoff("Completed specialist section handoff.", legacy, "2026-09-26T10:00:00.000Z");
    expect(match).toMatchObject({
      goal: "legacy goal",
      summary: "legacy summary",
      decisions: ["one", "two"],
      artifacts: ["a.ts"],
      openItems: [],
    });
  });

  it("ignores untagged turns", () => {
    const match = parseSpecialistHandoff("hi", "hello", "2026-09-26T10:00:00.000Z");
    expect(match).toBeNull();
  });
});
