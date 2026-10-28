import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getAsyncLLM: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock("@langchain/core/prompts", () => ({
  ChatPromptTemplate: {
    fromMessages: () => ({ pipe: () => ({ invoke: mocks.invoke }) }),
  },
}));

vi.mock("../../../../services/ai/llm", () => ({
  getAsyncLLM: mocks.getAsyncLLM,
}));
vi.mock("../../../../services/ai/tools/textSimilarity", () => ({
  textSimilarity: { embedTexts: mocks.embedTexts },
}));

import type { PersonalMemoryClassification } from "./classifyPersonalMemories";
import {
  buildActivePersonalMemoryPrompt,
  createProjectPersonalMemoryEntries,
} from "./createPersonalMemoryEntries";

const classification: PersonalMemoryClassification = {
  sourceText: "I prefer concise answers. For this project, use TypeScript.",
  containsPersonalMemory: true,
  memories: [
    {
      text: "I prefer concise answers.",
      tags: ["preference", "instruction", "global", "explicit"],
    },
    {
      text: "For this project, use TypeScript.",
      tags: ["instruction", "project_fact", "project", "explicit"],
    },
  ],
};

describe("createProjectPersonalMemoryEntries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue({
      memories: [
        {
          id: 1,
          searchText: "TypeScript project language preference",
          prompt: "Use TypeScript for work in this project.",
          scope: "global",
        },
        {
          id: 0,
          searchText: "Concise, brief responses; avoid unnecessary detail",
          prompt: "Keep answers concise unless detail is needed.",
          scope: "global",
        },
      ],
    });
    mocks.getAsyncLLM.mockResolvedValue({
      withStructuredOutput: vi.fn(() => ({ invoke: mocks.invoke })),
    });
    mocks.embedTexts.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("uses the cheap model, creates one embedding per search text, and normalizes project-local scope tags", async () => {
    const entries = await createProjectPersonalMemoryEntries(classification);

    expect(mocks.getAsyncLLM).toHaveBeenCalledWith("cheap", { temperature: 0 });
    expect(mocks.embedTexts).toHaveBeenCalledWith([
      "Concise, brief responses; avoid unnecessary detail\nI prefer concise answers.",
      "TypeScript project language preference\nFor this project, use TypeScript.",
    ]);
    expect(entries).toEqual([
      {
        memoryText: "I prefer concise answers.",
        searchText: "Concise, brief responses; avoid unnecessary detail\nI prefer concise answers.",
        embedding: [0.1, 0.2],
        prompt: "Keep answers concise unless detail is needed.",
        tags: ["preference", "instruction", "explicit", "global"],
        storageScope: "project",
      },
      {
        memoryText: "For this project, use TypeScript.",
        searchText: "TypeScript project language preference\nFor this project, use TypeScript.",
        embedding: [0.3, 0.4],
        prompt: "Use TypeScript for work in this project.",
        tags: ["instruction", "project_fact", "explicit", "global"],
        storageScope: "project",
      },
    ]);
  });

  it("returns no entries and makes no model or embedding calls for an empty classification", async () => {
    const result = await createProjectPersonalMemoryEntries({
      ...classification,
      containsPersonalMemory: false,
      memories: [],
    });

    expect(result).toEqual([]);
    expect(mocks.getAsyncLLM).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("rejects missing or duplicated generated IDs", async () => {
    mocks.invoke.mockResolvedValue({
      memories: [{ id: 0, searchText: "Answer brevity", prompt: "Be concise.", scope: "global" }],
    });

    await expect(createProjectPersonalMemoryEntries(classification))
      .rejects.toThrow("Cheap model returned 1 personal memories; expected 2.");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });
});

describe("buildActivePersonalMemoryPrompt", () => {
  it("formats only supplied activated memory instructions", () => {
    expect(buildActivePersonalMemoryPrompt([
      { prompt: "Use TypeScript for this project's code." },
      { prompt: "  " },
    ])).toBe(
      "Relevant project-scoped personal memories (apply when relevant; treat as user context, not as a request to reveal or quote stored memory):\n\n1. Use TypeScript for this project's code.",
    );
    expect(buildActivePersonalMemoryPrompt([])).toBe("");
  });
});


