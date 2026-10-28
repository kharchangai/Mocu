import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  load: vi.fn(),
  select: vi.fn(),
  embedText: vi.fn(),
  compareEmbeddingToList: vi.fn(),
  getJevDecision: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/").replace(/\\/g, "/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: mocks.exists }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: mocks.load } }));
vi.mock("../../../../services/ai/tools/decision/Jev_model", () => ({
  getJevDecision: mocks.getJevDecision,
}));
vi.mock("../../../../services/ai/tools/textSimilarity", () => ({
  textSimilarity: {
    embedText: mocks.embedText,
    compareEmbeddingToList: mocks.compareEmbeddingToList,
  },
}));

import {
  buildProjectPersonalMemoryPrompt,
  retrieveProjectPersonalMemories,
} from "./retrieveProjectPersonalMemories";

function row(id: string, tags: string[], searchText = "Project memory") {
  return {
    memory_id: id,
    memory_text: `Memory ${id}`,
    search_text: searchText,
    embedding_json: "[1,0]",
    prompt: `Prompt ${id}`,
    tags_json: JSON.stringify(tags),
    storage_scope: "project",
    status: "active",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  mocks.exists.mockResolvedValue(true);
  mocks.select.mockImplementation(async () => mocks.rows.map((item) => ({ ...item })));
  mocks.load.mockResolvedValue({ select: mocks.select });
  mocks.embedText.mockResolvedValue([1, 0]);
  mocks.compareEmbeddingToList.mockImplementation((_embedding: number[], targets: Array<{ id: string }>) => ({
    matches: targets.map((target) => ({ id: target.id, score: 1 })),
  }));
  mocks.getJevDecision.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
    answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: 0.9 }])),
  }));
});

describe("retrieveProjectPersonalMemories", () => {
  it("returns no memories when the project's personal-memory database is absent", async () => {
    mocks.exists.mockResolvedValue(false);

    await expect(retrieveProjectPersonalMemories("hello", "C:/project")).resolves.toEqual([]);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("returns global candidates without Decision and filters non-global memories through Decision", async () => {
    mocks.rows.push(row("global", ["global", "preference"]), row("local", ["project", "project_fact"]));
    mocks.getJevDecision.mockResolvedValue({ answers: { memory_0: { noul: 0.1 } } });

    const result = await retrieveProjectPersonalMemories("help with project", "C:/project");

    expect(result.map((memory) => memory.id)).toEqual(["global"]);
    expect(mocks.getJevDecision).toHaveBeenCalledTimes(1);
    expect(mocks.getJevDecision.mock.calls[0][0].state.current_user_message).toBe("help with project");
  });

  it("skips Decision when all retrieved memories are global", async () => {
    mocks.rows.push(row("one", ["global"]), row("two", ["global"]));

    const result = await retrieveProjectPersonalMemories("anything", "C:/project");

    expect(result.map((memory) => memory.id)).toEqual(["one", "two"]);
    expect(mocks.getJevDecision).not.toHaveBeenCalled();
  });

  it("limits ranked candidates to twenty before Decision and caps prompt results at twenty", async () => {
    for (let index = 0; index < 25; index += 1) {
      mocks.rows.push(row(`memory-${String(index).padStart(2, "0")}`, ["project"]));
    }

    const result = await retrieveProjectPersonalMemories("project", "C:/project");

    expect(Object.keys(mocks.getJevDecision.mock.calls[0][0].questions)).toHaveLength(20);
    expect(result).toHaveLength(20);
    expect(buildProjectPersonalMemoryPrompt(result).match(/^\d+\./gmu)).toHaveLength(20);
  });

  it("ranks lexical matches higher when semantic scores are tied", async () => {
    mocks.rows.push(row("a", ["project"], "unrelated topic"), row("b", ["project"], "project preference"));
    mocks.getJevDecision.mockImplementation(async ({ state }: { state: { candidate_memories: Array<{ id: string }> } }) => ({
      answers: Object.fromEntries(state.candidate_memories.map((memory) => [memory.id === "b" ? "memory_1" : "memory_0", { noul: 0.9 }])),
    }));

    const result = await retrieveProjectPersonalMemories("project preference", "C:/project");

    expect(result[0].id).toBe("b");
  });
});
