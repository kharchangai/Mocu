import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classify: vi.fn(),
  createEntries: vi.fn(),
  saveEntries: vi.fn(),
}));

vi.mock("./classifyPersonalMemories", () => ({
  classifyPersonalMemories: mocks.classify,
}));
vi.mock("./createPersonalMemoryEntries", () => ({
  createProjectPersonalMemoryEntries: mocks.createEntries,
}));
vi.mock("./saveProjectPersonalMemoryEntries", () => ({
  saveProjectPersonalMemoryEntries: mocks.saveEntries,
}));

import { processProjectPersonalMemoryMessage } from "./processProjectPersonalMemoryMessage";

describe("processProjectPersonalMemoryMessage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("classifies, prepares, and saves identified memories in order", async () => {
    const classification = {
      sourceText: "I prefer concise answers.",
      containsPersonalMemory: true,
      memories: [{ text: "I prefer concise answers.", tags: ["preference"] }],
    };
    const entries = [{ memoryText: "I prefer concise answers." }];
    const saveResult = { databasePath: "C:/project/.mocu/storage/personal-memory.db", databaseCreated: true, items: [] };
    mocks.classify.mockResolvedValue(classification);
    mocks.createEntries.mockResolvedValue(entries);
    mocks.saveEntries.mockResolvedValue(saveResult);

    const result = await processProjectPersonalMemoryMessage("I prefer concise answers.", "C:/project");

    expect(mocks.classify).toHaveBeenCalledWith("I prefer concise answers.", { signal: undefined });
    expect(mocks.createEntries).toHaveBeenCalledWith(classification, { signal: undefined });
    expect(mocks.saveEntries).toHaveBeenCalledWith("C:/project", entries, {
      signal: undefined,
      similarityThreshold: undefined,
    });
    expect(result).toEqual({ classification, entries, saveResult });
  });

  it("does not create entries or touch the database when no memory is found", async () => {
    const classification = { sourceText: "Hello.", containsPersonalMemory: false, memories: [] };
    mocks.classify.mockResolvedValue(classification);

    const result = await processProjectPersonalMemoryMessage("Hello.", "C:/project");

    expect(mocks.createEntries).not.toHaveBeenCalled();
    expect(mocks.saveEntries).not.toHaveBeenCalled();
    expect(result).toEqual({ classification, entries: [], saveResult: null });
  });

  it("rejects a missing project path", async () => {
    await expect(processProjectPersonalMemoryMessage("I prefer tea.", " "))
      .rejects.toThrow("projectPath must be a non-empty project folder path.");
    expect(mocks.classify).not.toHaveBeenCalled();
  });
});
