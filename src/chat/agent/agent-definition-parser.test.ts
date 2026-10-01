import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, writeTextFile } = vi.hoisted(() => ({
  invoke: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../../services/ai/llm", () => ({
  getAsyncLLM: vi.fn(async () => ({
    withStructuredOutput: vi.fn(() => ({ invoke })),
  })),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => true),
  mkdir: vi.fn(),
  writeTextFile,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:/appdata"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

import { parseAgentDefinition } from "./agent-definition-parser";

describe("parseAgentDefinition Jev tool handoff", () => {
  beforeEach(() => {
    invoke.mockReset();
    writeTextFile.mockReset();
    invoke.mockResolvedValue({
      agentName: "Project Tester",
      description: "Runs project tests and checks results.",
      mainInstruction: "Inspect the project, run relevant tests, and report verified results.",
      agents: [],
      skills: [],
      tools: [],
      extensions: [],
      llm: null,
    });
  });

  it("passes Jev-selected tool names and descriptions to the LLM and persists only those exact names", async () => {
    const definition = await parseAgentDefinition(
      "Create an agent that runs project tests.",
      { selectedTools: ["terminal_executor"] },
    );

    const [messages] = invoke.mock.calls[0];
    expect(messages[0].content).toContain("terminal_executor");
    expect(messages[0].content).toContain("Run terminal, shell, or command-line commands");
    expect(definition.tools).toEqual(["terminal_executor"]);
    expect(definition.toolSelectionConfigured).toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:/appdata/agents/Project Tester/Project Tester.json",
      expect.stringContaining('"tools": [\n    "terminal_executor"'),
    );
  });

  it("marks an empty Jev selection as deliberate rather than using implicit defaults", async () => {
    const definition = await parseAgentDefinition("Create a conversational agent.", {
      selectedTools: [],
    });

    expect(definition.tools).toEqual([]);
    expect(definition.toolSelectionConfigured).toBe(true);
    expect(invoke.mock.calls[0][0][0].content).toContain("(none)");
  });
});
