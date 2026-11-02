import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision: vi.fn(),
}));

import { getJevDecision } from "../../../../services/ai/tools/decision/Jev_model";
import {
  classifyPersonalMemories,
  PERSONAL_MEMORY_TAGS,
  splitPersonalMemoryCandidates,
} from "./classifyPersonalMemories";

const mockedGetJevDecision = vi.mocked(getJevDecision);

describe("splitPersonalMemoryCandidates", () => {
  it("splits sentence-sized spans and preserves their exact wording", () => {
    expect(splitPersonalMemoryCandidates("I prefer concise answers. Use examples!\nOnly for this project?"))
      .toEqual([
        "I prefer concise answers.",
        "Use examples!",
        "Only for this project?",
      ]);
  });

  it("does not split a decimal or a period without following whitespace", () => {
    expect(splitPersonalMemoryCandidates("My version is 2.4. Use terminal tools."))
      .toEqual(["My version is 2.4.", "Use terminal tools."]);
  });
});

describe("classifyPersonalMemories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns separate exact text spans with multiple applicable tags", async () => {
    mockedGetJevDecision.mockImplementation(async ({ questions }) => {
      const answers: Record<string, { noul: number }> = {};
      for (const key of Object.keys(questions)) answers[key] = { noul: 0 };

      if ("message_contains_personal_memory" in questions) {
        answers.message_contains_personal_memory = { noul: 0.95 };
      }
      answers.candidate_0_is_personal_memory = { noul: 0.95 };
      answers.candidate_0_tag_preference = { noul: 0.9 };
      answers.candidate_0_tag_global = { noul: 0.85 };
      answers.candidate_0_tag_explicit = { noul: 0.8 };

      answers.candidate_1_is_personal_memory = { noul: 0.9 };
      answers.candidate_1_tag_workflow = { noul: 0.9 };
      answers.candidate_1_tag_task = { noul: 0.85 };
      answers.candidate_1_tag_implicit = { noul: 0.8 };

      return { answers };
    });

    const result = await classifyPersonalMemories(
      "Please answer me in English. I find terminal-based coding easier.",
    );

    expect(result).toEqual({
      sourceText: "Please answer me in English. I find terminal-based coding easier.",
      containsPersonalMemory: true,
      memories: [
        {
          text: "Please answer me in English.",
          tags: ["preference", "global", "explicit"],
        },
        {
          text: "I find terminal-based coding easier.",
          tags: ["workflow", "task", "implicit"],
        },
      ],
    });
    expect(mockedGetJevDecision).toHaveBeenCalledTimes(2);
    expect(mockedGetJevDecision.mock.calls[0]?.[0].questions).toHaveProperty(
      "message_contains_personal_memory",
    );
    expect(mockedGetJevDecision.mock.calls[1]?.[0].questions).toHaveProperty(
      "candidate_0_is_personal_memory",
    );
  });

  it("processes more than 24 candidates in sequential batches of four after the gate passes", async () => {
    mockedGetJevDecision.mockImplementation(async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((key) => [
          key,
          { noul: key === "message_contains_personal_memory" ? 1 : 0 },
        ]),
      ),
    }));

    const message = Array.from({ length: 25 }, (_, index) => `Line ${index + 1}.`).join("\n");
    const result = await classifyPersonalMemories(message);

    expect(result.sourceText).toBe(message);
    expect(result.memories).toEqual([]);
    expect(mockedGetJevDecision).toHaveBeenCalledTimes(8);
    expect(mockedGetJevDecision.mock.calls[0]?.[0].state).toEqual({
      complete_user_message: message,
    });

    const batchSizes = mockedGetJevDecision.mock.calls.slice(1).map(([input]) =>
      (input.state as { candidate_spans: unknown[] }).candidate_spans.length,
    );
    expect(batchSizes).toEqual([4, 4, 4, 4, 4, 4, 1]);
    expect(mockedGetJevDecision.mock.calls[1]?.[0].state).not.toHaveProperty("complete_user_message");
  });

  it("returns an empty memory list when no span qualifies", async () => {
    mockedGetJevDecision.mockImplementation(async ({ questions }) => ({
      answers: Object.fromEntries(
        Object.keys(questions).map((key) => [key, { noul: 0.05 }]),
      ),
    }));

    const result = await classifyPersonalMemories("What is the weather today?");

    expect(result.containsPersonalMemory).toBe(false);
    expect(result.memories).toEqual([]);
    expect(mockedGetJevDecision).toHaveBeenCalledOnce();
    expect(mockedGetJevDecision.mock.calls[0]?.[0].questions).toHaveProperty(
      "message_contains_personal_memory",
    );
  });

  it("rejects incomplete Decision responses rather than silently misclassifying", async () => {
    mockedGetJevDecision.mockResolvedValue({ answers: {} });

    await expect(classifyPersonalMemories("I prefer English."))
      .rejects.toThrow('Decision model response is missing "message_contains_personal_memory".');
  });

  it("exposes the fixed tag vocabulary", () => {
    expect(PERSONAL_MEMORY_TAGS).toContain("implicit");
    expect(PERSONAL_MEMORY_TAGS).toContain("global");
    expect(PERSONAL_MEMORY_TAGS).toContain("temporary");
  });
});
