/**
 * Assignment of MCP tools to saved agents.
 *
 * Agent definitions (AppData/agents/<name>/<name>.json) carry a `tools`
 * string array. MCP tool access is stored there as references of the form:
 *
 *   mcp:<server-id>/<tool-name>   (one tool)
 *   mcp:<server-id>/*             (every tool of a server)
 *
 * Importing a server or discovering a new tool never touches agent files;
 * assignment happens only through these explicit user actions.
 */

import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { findAvailableAgent, listAvailableAgents } from '../chat/agent/agent-loader';

import { formatMcpToolReference, parseMcpToolReference } from './tool-adapter';
import type { McpToolSelection } from './tool-adapter';

/** All MCP tool references currently assigned to an agent. */
export async function getAgentMcpToolReferences(
  agentName: string,
): Promise<McpToolSelection[]> {
  const agent = await findAvailableAgent(agentName);
  if (!agent) {
    return [];
  }

  const selections: McpToolSelection[] = [];
  for (const tool of agent.tools) {
    const parsed = parseMcpToolReference(tool);
    if (parsed) {
      selections.push(parsed);
    }
  }
  return selections;
}

/**
 * Adds an MCP tool reference to an agent's saved tool list.
 * No-op when the reference is already present.
 */
export async function assignMcpToolToAgent(
  agentName: string,
  selection: McpToolSelection,
): Promise<void> {
  await updateAgentTools(agentName, (tools) => {
    const reference = formatMcpToolReference(selection);
    if (tools.includes(reference)) {
      return null;
    }
    return [...tools, reference];
  });
}

/** Removes an MCP tool reference from an agent's saved tool list. */
export async function unassignMcpToolFromAgent(
  agentName: string,
  selection: McpToolSelection,
): Promise<void> {
  const reference = formatMcpToolReference(selection);
  const wildcard = formatMcpToolReference({ serverId: selection.serverId });

  await updateAgentTools(agentName, (tools) => {
    const next = tools.filter(
      (tool) =>
        tool !== reference &&
        // Removing a whole-server assignment also removes the reference.
        !(selection.toolName === undefined && tool === wildcard),
    );
    return next.length === tools.length ? null : next;
  });
}

/**
 * Applies a transform to an agent's saved tool list. Returning null from
 * the transform skips the write (no change).
 */
async function updateAgentTools(
  agentName: string,
  transform: (tools: string[]) => string[] | null,
): Promise<void> {
  const agent = await findAvailableAgent(agentName);
  if (!agent) {
    throw new Error(`Agent "${agentName}" was not found.`);
  }

  const nextTools = transform(agent.tools);
  if (nextTools === null) {
    return;
  }

  const definition = JSON.parse(await readTextFile(agent.path)) as Record<
    string,
    unknown
  >;
  definition.tools = nextTools;

  await writeTextFile(agent.path, JSON.stringify(definition, null, 2));
}

/** Lists saved agents (used by the assignment UI). */
export async function listAgentsForAssignment(): Promise<
  { name: string; description: string }[]
> {
  const agents = await listAvailableAgents();
  return agents.map((agent) => ({
    name: agent.agentName,
    description: agent.description,
  }));
}
