import {
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';

import type { AvailableAgent } from './agent-loader';
import { listAvailableAgents } from './agent-loader';
import type { AgentDefinition } from './agent-definition-parser';

function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'unnamed-agent';
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key] ?? record[key[0].toUpperCase() + key.slice(1)];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))];
}

/** Parse and validate an agent definition imported from a JSON file. */
export async function readImportedAgent(path: string): Promise<AgentDefinition> {
  const value: unknown = JSON.parse(await readTextFile(path));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The selected file must contain an agent JSON object.');
  }
  const record = value as Record<string, unknown>;
  const agentName = readString(record, 'agentName', 'name');
  const mainInstruction = readString(record, 'mainInstruction', 'instruction', 'Instruction');
  if (!agentName || !mainInstruction) {
    throw new Error('The agent definition must include a name and main instruction.');
  }
  const description = readString(record, 'description', 'Description') || mainInstruction.replace(/\s+/g, ' ').slice(0, 140);
  return {
    agentName,
    description,
    mainInstruction,
    agents: readStringArray(record, 'agents'),
    skills: readStringArray(record, 'skills'),
    tools: readStringArray(record, 'tools'),
    toolSelectionConfigured: typeof record.toolSelectionConfigured === 'boolean' ? record.toolSelectionConfigured : undefined,
    extensions: readStringArray(record, 'extensions'),
    llm: readString(record, 'llm', 'model', 'LLM') || null,
  };
}

async function getAgentPath(agentName: string): Promise<string> {
  const root = await join(await appDataDir(), 'agents');
  const folder = safeFolderName(agentName);
  return join(await join(root, folder), `${folder}.json`);
}

export async function installAgentDefinition(definition: AgentDefinition): Promise<void> {
  const duplicate = (await listAvailableAgents()).find(
    (agent) => agent.agentName.toLocaleLowerCase() === definition.agentName.toLocaleLowerCase(),
  );
  if (duplicate) throw new Error(`An agent named “${duplicate.agentName}” is already installed.`);

  const path = await getAgentPath(definition.agentName);
  if (await exists(path)) throw new Error('An agent definition already exists at the install location.');
  await mkdir(await join(await appDataDir(), 'agents', safeFolderName(definition.agentName)), { recursive: true });
  await writeTextFile(path, JSON.stringify(definition, null, 2));
}

export async function saveEditedAgent(
  current: AvailableAgent,
  definition: AgentDefinition,
): Promise<void> {
  const agents = await listAvailableAgents();
  const duplicate = agents.find(
    (agent) => agent.path !== current.path && agent.agentName.toLocaleLowerCase() === definition.agentName.toLocaleLowerCase(),
  );
  if (duplicate) throw new Error(`Another agent named “${duplicate.agentName}” is already installed.`);

  const nextPath = await getAgentPath(definition.agentName);
  if (nextPath !== current.path && await exists(nextPath)) {
    throw new Error('Another file already exists at the new agent location.');
  }
  await mkdir(await join(await appDataDir(), 'agents', safeFolderName(definition.agentName)), { recursive: true });
  await writeTextFile(nextPath, JSON.stringify(definition, null, 2));
  if (nextPath !== current.path) await remove(current.path);
}

export async function deleteAgentDefinition(agent: AvailableAgent): Promise<void> {
  await remove(agent.path);
}
