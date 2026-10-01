import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { findAvailableAgent, listAvailableAgents } from "../../../chat/agent/agent-loader";
import type { AgentDefinition } from "../../../chat/agent/agent-definition-parser";
import { writeTextFile } from "@tauri-apps/plugin-fs";

const AgentUpdatesSchema = z.object({
  agentName: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  mainInstruction: z.string().trim().min(1).optional(),
  agents: z.array(z.string().trim().min(1)).optional(),
  skills: z.array(z.string().trim().min(1)).optional(),
  tools: z.array(z.string().trim().min(1)).optional(),
  toolSelectionConfigured: z.boolean().optional(),
  extensions: z.array(z.string().trim().min(1)).optional(),
  llm: z.string().trim().min(1).nullable().optional(),
}).strict();

function normalizeReferences(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return [...new Map(values.map((value) => [value.trim().toLocaleLowerCase(), value.trim()])).values()];
}

function getDefinition(agent: Awaited<ReturnType<typeof findAvailableAgent>>): AgentDefinition | null {
  if (!agent) return null;
  return {
    agentName: agent.agentName,
    description: agent.description,
    mainInstruction: agent.mainInstruction,
    agents: agent.agents,
    skills: agent.skills,
    tools: agent.tools,
    toolSelectionConfigured: agent.toolSelectionConfigured,
    extensions: agent.extensions,
    llm: agent.llm,
  };
}

export const listAgentsTool = tool(
  async () => {
    const agents = await listAvailableAgents();
    return JSON.stringify(agents.map((agent) => ({
      agentName: agent.agentName,
      description: agent.description,
      skills: agent.skills,
      tools: agent.tools,
      extensions: agent.extensions,
      childAgents: agent.agents,
      llm: agent.llm,
    })), null, 2);
  },
  {
    name: "list_agents",
    description: "List the user's saved specialist agents and their summaries. Use this to identify the exact agent before reading or updating it.",
    schema: z.object({}),
  },
);

export const readAgentTool = tool(
  async ({ agentName }) => {
    const agent = await findAvailableAgent(agentName);
    const definition = getDefinition(agent);
    if (!definition) throw new Error(`Saved agent \"${agentName}\" was not found.`);
    return JSON.stringify(definition, null, 2);
  },
  {
    name: "read_agent",
    description: "Read the full saved definition of one user agent by its exact name. Read it before updating so unchanged fields can be preserved.",
    schema: z.object({
      agentName: z.string().trim().min(1).describe("The exact saved agent name, as returned by list_agents."),
    }),
  },
);

export const updateAgentTool = tool(
  async ({ agentName, updates }) => {
    if (Object.keys(updates).length === 0) {
      throw new Error("Provide at least one agent field to update.");
    }

    const agent = await findAvailableAgent(agentName);
    if (!agent) throw new Error(`Saved agent \"${agentName}\" was not found. Use list_agents to check the exact name.`);

    const requestedName = updates.agentName?.trim() ?? agent.agentName;
    const duplicate = (await listAvailableAgents()).find(
      (candidate) => candidate.path.toLocaleLowerCase() !== agent.path.toLocaleLowerCase() &&
        candidate.agentName.toLocaleLowerCase() === requestedName.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`Another saved agent is already named \"${requestedName}\".`);

    const current = getDefinition(agent);
    if (!current) throw new Error(`Could not read saved agent \"${agentName}\".`);

    const next: AgentDefinition = {
      ...current,
      ...updates,
      agentName: requestedName,
      agents: normalizeReferences(updates.agents) ?? current.agents,
      skills: normalizeReferences(updates.skills) ?? current.skills,
      tools: normalizeReferences(updates.tools) ?? current.tools,
      toolSelectionConfigured:
        updates.tools === undefined
          ? current.toolSelectionConfigured
          : (updates.toolSelectionConfigured ?? true),
      extensions: normalizeReferences(updates.extensions) ?? current.extensions,
      llm: updates.llm === undefined ? current.llm : updates.llm?.trim() || null,
    };

    await writeTextFile(agent.path, JSON.stringify(next, null, 2));
    return JSON.stringify({
      updated: true,
      agent: next,
      note: "Only supplied fields were changed; omitted fields were preserved.",
    }, null, 2);
  },
  {
    name: "update_agent",
    description: "Update an existing saved user agent. Only change fields the user explicitly asked to edit; omitted fields are preserved. Use list_agents/read_agent first when the target or current definition is unclear. This tool updates an existing agent and does not create or delete agents.",
    schema: z.object({
      agentName: z.string().trim().min(1).describe("The exact current saved agent name to update."),
      updates: AgentUpdatesSchema.describe("Only the fields the user explicitly wants changed. Supported fields: agentName, description, mainInstruction, agents, skills, tools, toolSelectionConfigured, extensions, llm. Set llm to null to use the default model."),
    }),
  },
);

export const agentManagementTools: StructuredToolInterface[] = [
  listAgentsTool,
  readAgentTool,
  updateAgentTool,
];
