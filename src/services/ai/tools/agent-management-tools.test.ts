import { beforeEach, describe, expect, it, vi } from "vitest";

const { findAvailableAgent, listAvailableAgents, writeTextFile } = vi.hoisted(() => ({
  findAvailableAgent: vi.fn(),
  listAvailableAgents: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../../../chat/agent/agent-loader", () => ({
  findAvailableAgent,
  listAvailableAgents,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile }));

import { updateAgentTool } from "./agent-management-tools";

const savedAgent = {
  agentName: "Writer",
  description: "Writes drafts",
  mainInstruction: "Write clear drafts.",
  agents: ["Researcher"],
  skills: ["Writing"],
  tools: ["read_file"],
  extensions: [],
  llm: null,
  id: "Writer",
  path: "C:/app/agents/Writer/Writer.json",
};

describe("update_agent tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findAvailableAgent.mockResolvedValue(savedAgent);
    listAvailableAgents.mockResolvedValue([savedAgent]);
    writeTextFile.mockResolvedValue(undefined);
  });

  it("changes only requested fields and preserves the rest", async () => {
    const result = await updateAgentTool.invoke({
      agentName: "Writer",
      updates: { description: "Writes concise drafts", skills: [] },
    });

    expect(writeTextFile).toHaveBeenCalledOnce();
    const [path, serialized] = writeTextFile.mock.calls[0] as [string, string];
    expect(path).toBe(savedAgent.path);
    expect(JSON.parse(serialized)).toEqual({
      agentName: "Writer",
      description: "Writes concise drafts",
      mainInstruction: savedAgent.mainInstruction,
      agents: savedAgent.agents,
      skills: [],
      tools: savedAgent.tools,
      extensions: savedAgent.extensions,
      llm: null,
    });
    expect(JSON.parse(result)).toMatchObject({ updated: true });
  });

  it("rejects a rename that conflicts with another saved agent", async () => {
    listAvailableAgents.mockResolvedValue([
      savedAgent,
      { ...savedAgent, agentName: "Researcher", id: "Researcher", path: "C:/app/agents/Researcher/Researcher.json" },
    ]);

    await expect(updateAgentTool.invoke({
      agentName: "Writer",
      updates: { agentName: "Researcher" },
    })).rejects.toThrow('already named "Researcher"');
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
