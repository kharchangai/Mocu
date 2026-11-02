import { beforeEach, describe, expect, it, vi } from "vitest";

const { exists, readTextFile, join, getJevDecision } = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  join: vi.fn(),
  getJevDecision: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({ join }));
vi.mock("@tauri-apps/plugin-fs", () => ({ exists, readTextFile }));
vi.mock("./decision/Jev_model", () => ({ getJevDecision }));

import { createProjectChatMemorySearchTool } from "./project-chat-memory-tool";

describe("project chat memory search tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    join.mockResolvedValue("E:/project/.mocu/memory/chat.json");
  });

  it("BM25-ranks prior chat messages then returns only Decision-selected relevant content", async () => {
    exists.mockResolvedValue(true);
    readTextFile.mockResolvedValue(JSON.stringify({ messages: [
      { id: "m1", role: "user", content: "We chose SQLite for local project history.", createdAt: "2026-01-01" },
      { id: "m2", role: "assistant", content: "The weather is sunny today.", createdAt: "2026-01-02" },
    ] }));
    getJevDecision.mockResolvedValue({ answers: { chat_0: { noul: 0.96 } } });

    const result = JSON.parse(String(await createProjectChatMemorySearchTool("E:/project").invoke({ query: "Why did we choose SQLite for project history?" })));

    expect(join).toHaveBeenCalledWith("E:/project", ".mocu", "memory", "chat.json");
    expect(getJevDecision).toHaveBeenCalledWith(expect.objectContaining({
      state: expect.objectContaining({ focused_query: "Why did we choose SQLite for project history?" }),
    }));
    expect(result.messages).toEqual([expect.objectContaining({
      role: "user",
      content: "We chose SQLite for local project history.",
    })]);
  });

  it("reports missing history without calling Decision", async () => {
    exists.mockResolvedValue(false);
    const result = JSON.parse(String(await createProjectChatMemorySearchTool("E:/project").invoke({ query: "past decision" })));
    expect(result.found).toBe(false);
    expect(getJevDecision).not.toHaveBeenCalled();
  });

  it("does not return candidates Decision marks irrelevant", async () => {
    exists.mockResolvedValue(true);
    readTextFile.mockResolvedValue(JSON.stringify({ messages: [
      { id: "m1", role: "assistant", content: "We use SQLite to store project memory.", createdAt: "2026-01-01" },
    ] }));
    getJevDecision.mockResolvedValue({ answers: { chat_0: { noul: 0.02 } } });
    const result = JSON.parse(String(await createProjectChatMemorySearchTool("E:/project").invoke({ query: "How is project memory stored in SQLite?" })));
    expect(result.found).toBe(false);
    expect(result.messages).toEqual([]);
  });
});
