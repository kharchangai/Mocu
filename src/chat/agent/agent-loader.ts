import {
  exists,
  mkdir,
  readDir,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { AgentDefinition } from './agent-definition-parser';

export type AvailableAgent = AgentDefinition & {
  id: string;
  path: string;
  description: string;
};

type JsonRecord = Record<string, unknown>;
type DirectoryEntry = Awaited<ReturnType<typeof readDir>>[number];

/**
 * Lists every valid agent definition stored in AppData/agents.
 *
 * Agent definitions created by agent-definition-parser are stored as:
 *   AppData/agents/<agent-name>/<agent-name>.json
 *
 * Direct JSON files and one-level nested JSON files are also accepted. This
 * makes the loader tolerant of agents installed by other parts of Mocu.
 */
export async function listAvailableAgents(): Promise<AvailableAgent[]> {
  const root = await join(await appDataDir(), 'agents');

  if (!(await exists(root))) {
    await mkdir(root, { recursive: true });
    return [];
  }

  const definitions: AvailableAgent[] = [];
  await scanAgentDirectory(root, definitions, 0);

  const byName = new Map<string, AvailableAgent>();
  for (const definition of definitions) {
    byName.set(definition.agentName.toLocaleLowerCase(), definition);
  }

  return [...byName.values()].sort((first, second) =>
    first.agentName.localeCompare(second.agentName),
  );
}

/** Backwards-friendly name for callers that describe this operation as a scan. */
export const findAllAgents = listAvailableAgents;

/**
 * Resolves one agent by display name, id, or its JSON file path.
 */
export async function findAvailableAgent(
  nameOrId: string,
): Promise<AvailableAgent | null> {
  const normalized = nameOrId.trim().toLocaleLowerCase();
  if (!normalized) {
    return null;
  }

  const agents = await listAvailableAgents();
  return (
    agents.find(
      (agent) =>
        agent.agentName.toLocaleLowerCase() === normalized ||
        agent.id.toLocaleLowerCase() === normalized ||
        agent.path.toLocaleLowerCase() === normalized,
    ) ?? null
  );
}

/** Alias used by the agent runner. */
export const loadAgentDefinition = findAvailableAgent;

async function scanAgentDirectory(
  directory: string,
  definitions: AvailableAgent[],
  depth: number,
): Promise<void> {
  let entries: DirectoryEntry[];

  try {
    entries = await readDir(directory);
  } catch (error) {
    console.error(`[Agent Loader] Failed to read ${directory}:`, error);
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = await join(directory, entry.name);

      if (entry.isFile && entry.name.toLocaleLowerCase().endsWith('.json')) {
        const definition = await readAgentFile(entryPath, entry.name);
        if (definition) {
          definitions.push(definition);
        }
        return;
      }

      // The normal layout is one directory below agents. A second level is
      // allowed for imported packages, but arbitrary recursion is avoided.
      if (entry.isDirectory && depth < 2) {
        await scanAgentDirectory(entryPath, definitions, depth + 1);
      }
    }),
  );
}

async function readAgentFile(
  path: string,
  fileName: string,
): Promise<AvailableAgent | null> {
  try {
    const raw = JSON.parse(await readTextFile(path)) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('The JSON root must be an object.');
    }

    const value = raw as JsonRecord;
    const fallbackName = fileName.replace(/\.json$/i, '');
    const agentName = readString(value, ['agentName', 'name']) || fallbackName;
    const mainInstruction = readString(value, [
      'mainInstruction',
      'instruction',
      'Instruction',
    ]);

    if (!agentName.trim() || !mainInstruction.trim()) {
      throw new Error('The definition requires a name and instruction.');
    }

    const description =
      readString(value, ['description', 'Description']) ||
      mainInstruction.trim().replace(/\s+/g, ' ').slice(0, 140);

    return {
      agentName: agentName.trim(),
      mainInstruction: mainInstruction.trim(),
      agents: readStringArray(value, ['agents', 'Agents']),
      skills: readStringArray(value, ['skills', 'Skills']),
      tools: readStringArray(value, ['tools', 'Tools']),
      extensions: readStringArray(value, ['extensions', 'Extensions']),
      llm: readNullableString(value, ['llm', 'model', 'LLM']),
      id: agentName.trim(),
      path,
      description,
    };
  } catch (error) {
    console.warn(`[Agent Loader] Skipping invalid agent ${path}:`, error);
    return null;
  }
}

function readString(value: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key] as string;
    }
  }
  return '';
}

function readNullableString(value: JsonRecord, keys: string[]): string | null {
  const result = readString(value, keys);
  return result || null;
}

function readStringArray(value: JsonRecord, keys: string[]): string[] {
  for (const key of keys) {
    if (!Array.isArray(value[key])) {
      continue;
    }

    return [...new Set(
      value[key].filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      ).map((item) => item.trim()),
    )];
  }
  return [];
}

