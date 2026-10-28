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
    expect(mockedGetJevDecision).toHaveBeenCalledOnce();
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
  });

  it("rejects incomplete Decision responses rather than silently misclassifying", async () => {
    mockedGetJevDecision.mockResolvedValue({ answers: {} });

    await expect(classifyPersonalMemories("I prefer English."))
      .rejects.toThrow('Decision model response is missing "candidate_0_is_personal_memory".');
  });

  it("exposes the fixed tag vocabulary", () => {
    expect(PERSONAL_MEMORY_TAGS).toContain("implicit");
    expect(PERSONAL_MEMORY_TAGS).toContain("global");
    expect(PERSONAL_MEMORY_TAGS).toContain("temporary");
  });
});
