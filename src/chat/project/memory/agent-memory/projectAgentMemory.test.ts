import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  getJevDecision: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ join: async (...parts: string[]) => parts.join("/").replace(/\\/g, "/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => mocks.files.has(path) || [...mocks.files.keys()].some((file) => file.startsWith(`${path.replace(/\/$/u, "")}/`)),
  mkdir: async () => undefined,
  readDir: async (path: string) => [...mocks.files.keys()]
    .filter((file) => file.startsWith(`${path.replace(/\/$/u, "")}/`))
    .map((file) => ({ name: file.slice(path.length + 1).split("/")[0], isDirectory: false, isSymlink: false }))
    .filter((entry, index, entries) => entries.findIndex((candidate) => candidate.name === entry.name) === index),
  readTextFile: async (path: string) => {
    const value = mocks.files.get(path);
    if (value === undefined) throw new Error("not found");
    return value;
  },
  writeTextFile: async (path: string, text: string) => { mocks.files.set(path, text); },
  remove: async (path: string) => { mocks.files.delete(path); },
}));
vi.mock("../../../../services/ai/tools/decision/Jev_model", () => ({ getJevDecision: mocks.getJevDecision }));

import {
  buildProjectAgentMemoryPrompt,
  deleteProjectAgentMemory,
  listProjectAgentMemories,
  readProjectAgentMemory,
  retrieveProjectAgentMemories,
  saveProjectAgentMemory,
  updateProjectAgentMemory,
} from "./projectAgentMemory";

beforeEach(() => {
  mocks.files.clear();
  vi.clearAllMocks();
  mocks.getJevDecision.mockImplementation(async ({ questions }: { questions: Record<string, unknown> }) => ({
    answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { noul: 0.9 }])),
  }));
});

describe("project-agent memory store", () => {
  it("persists tagged records in this project and supports list/read/update/delete", async () => {
    const saved = await saveProjectAgentMemory("C:/demo", { content: "Use the api folder for service clients.", tags: ["Architecture", "global"] });
    expect([...mocks.files.keys()][0]).toContain("C:/demo/.mocu/agent-memory/");
    expect(saved.tags).toEqual(["architecture", "global"]);
    expect(await readProjectAgentMemory("C:/demo", saved.id)).toEqual(saved);
    expect(await listProjectAgentMemories("C:/demo")).toHaveLength(1);

    const updated = await updateProjectAgentMemory("C:/demo", saved.id, { tags: ["architecture"] });
    expect(updated.tags).toEqual(["architecture"]);
    await deleteProjectAgentMemory("C:/demo", saved.id);
    expect(await listProjectAgentMemories("C:/demo")).toEqual([]);
  });

  it("always retrieves all global memories and sends non-global candidates to Decision", async () => {
    const global = await saveProjectAgentMemory("C:/demo", { content: "Always answer in Persian.", tags: ["global", "response-style"] });
    const local = await saveProjectAgentMemory("C:/demo", { content: "Use the api folder for service clients.", tags: ["architecture"] });

    const result = await retrieveProjectAgentMemories("Create an API service client", "C:/demo");
    expect(result.map((memory) => memory.id)).toEqual([global.id, local.id]);
    expect(mocks.getJevDecision).toHaveBeenCalledTimes(1);
    expect(mocks.getJevDecision.mock.calls[0][0].state.candidate_memories[0].tags).toEqual(["architecture"]);
    expect(buildProjectAgentMemoryPrompt(result)).toContain("Always answer in Persian.");
  });

  it("preserves global memories if Decision fails and does not call Decision for global-only entries", async () => {
    const global = await saveProjectAgentMemory("C:/demo", { content: "Always use concise answers.", tags: ["global"] });
    expect((await retrieveProjectAgentMemories("unrelated", "C:/demo")).map((memory) => memory.id)).toEqual([global.id]);
    expect(mocks.getJevDecision).not.toHaveBeenCalled();

    await saveProjectAgentMemory("C:/demo", { content: "Use npm for package scripts.", tags: ["workflow"] });
    mocks.getJevDecision.mockRejectedValueOnce(new Error("offline"));
    expect((await retrieveProjectAgentMemories("package commands", "C:/demo")).map((memory) => memory.id)).toEqual([global.id]);
  });

  it("rejects non-absolute paths, unsafe IDs, and empty tags", async () => {
    await expect(saveProjectAgentMemory("relative", { content: "Remember this", tags: ["global"] })).rejects.toThrow("absolute");
    await expect(readProjectAgentMemory("C:/demo", "../secret")).rejects.toThrow("valid project-agent memory ID");
    await expect(saveProjectAgentMemory("C:/demo", { content: "Remember this", tags: [] })).rejects.toThrow("between 1 and 12 tags");
  });
});
