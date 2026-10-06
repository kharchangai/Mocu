import JSZip from 'jszip';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { appDataDir, dirname, join } from '@tauri-apps/api/path';

import type { AvailableAgent } from './agent-loader';
import { listAvailableAgents } from './agent-loader';
import type { AgentDefinition } from './agent-definition-parser';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_PACKAGE_FILES = 1000;

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

function parseAgentDefinition(text: string): AgentDefinition {
  const value: unknown = JSON.parse(text);
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

/** Parse and validate an agent definition imported from a legacy JSON file. */
export async function readImportedAgent(path: string): Promise<AgentDefinition> {
  return parseAgentDefinition(await readTextFile(path));
}

async function getAgentPath(agentName: string): Promise<string> {
  const folder = safeFolderName(agentName);
  return join(await join(await appDataDir(), 'agents', folder), `${folder}.json`);
}

function archivePath(entry: JSZip.JSZipObject): string {
  const original = entry.unsafeOriginalName ?? entry.name;
  if (original.includes('\\') || original.startsWith('/') || /^[a-zA-Z]:/.test(original) || original.includes('\0')) {
    throw new Error('The ZIP contains an unsafe file path.');
  }
  const segments = original.split('/').filter((segment, index, all) => !(segment === '' && index === all.length - 1));
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new Error('The ZIP contains an unsafe file path.');
  }
  const mode = typeof entry.unixPermissions === 'number'
    ? entry.unixPermissions
    : typeof entry.unixPermissions === 'string' ? Number.parseInt(entry.unixPermissions, 8) : 0;
  if ((mode & 0o170000) === 0o120000) throw new Error('Symbolic links are not allowed in agent ZIP files.');
  return segments.join('/');
}

/** Read and install an agent ZIP, preserving every file in its package folder. */
export async function installAgentPackage(zipPath: string): Promise<AgentDefinition> {
  const archiveBytes = await readFile(zipPath);
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('The agent ZIP is too large (maximum 50 MB).');

  const zip = await JSZip.loadAsync(archiveBytes, { checkCRC32: true });
  const entries = Object.values(zip.files);
  const files = entries.filter((entry) => !entry.dir);
  if (files.length === 0 || files.length > MAX_PACKAGE_FILES) {
    throw new Error(`The agent ZIP must contain between 1 and ${MAX_PACKAGE_FILES} files.`);
  }

  const paths = new Map<JSZip.JSZipObject, string>();
  const seen = new Set<string>();
  let estimatedBytes = 0;
  for (const entry of entries) {
    const path = archivePath(entry);
    paths.set(entry, path);
    if (!path || entry.dir) continue;
    const key = path.toLocaleLowerCase();
    if (seen.has(key)) throw new Error('The ZIP contains duplicate file paths.');
    seen.add(key);
    const size = (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === 'number') estimatedBytes += size;
  }
  if (estimatedBytes > MAX_PACKAGE_BYTES) throw new Error('The uncompressed agent package is too large (maximum 100 MB).');

  // Accept either files at the ZIP root or a single enclosing package folder.
  const filePaths = files.map((entry) => paths.get(entry)!).filter(Boolean);
  const firstSegment = filePaths[0]?.split('/')[0];
  const wrapperRoot = firstSegment && filePaths.every((path) => path.startsWith(`${firstSegment}/`)) ? firstSegment : '';
  const wrapper = wrapperRoot ? `${wrapperRoot}/` : '';
  const relativePath = (path: string) => wrapper && (path === wrapperRoot || path.startsWith(wrapper))
    ? path === wrapperRoot ? '' : path.slice(wrapper.length)
    : path;

  const candidates: Array<{ path: string; definition: AgentDefinition }> = [];
  for (const entry of files) {
    const path = relativePath(paths.get(entry)!);
    if (!path.toLocaleLowerCase().endsWith('.json') || path.split('/').length > 2) continue;
    try {
      candidates.push({ path, definition: parseAgentDefinition(await entry.async('string')) });
    } catch {
      // Other JSON files in an agent package are assets, not its definition.
    }
  }
  const preferred = candidates.filter(({ path }) => /(^|\/)(agent|agent-definition)\.json$/i.test(path));
  const selected = preferred.length === 1 ? preferred[0] : candidates.length === 1 ? candidates[0] : null;
  if (!selected) {
    throw new Error(candidates.length > 1
      ? 'The ZIP contains multiple agent definitions. Keep one agent definition in the package.'
      : 'The ZIP must contain an agent JSON definition at its root (or inside one package folder).');
  }

  const duplicate = (await listAvailableAgents()).find(
    (agent) => agent.agentName.toLocaleLowerCase() === selected.definition.agentName.toLocaleLowerCase(),
  );
  if (duplicate) throw new Error(`An agent named “${duplicate.agentName}” is already installed.`);

  const root = await join(await appDataDir(), 'agents');
  const target = await join(root, safeFolderName(selected.definition.agentName));
  if (await exists(target)) throw new Error('An agent package already exists at the install location.');
  const staging = await join(root, `.agent-install-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(staging, { recursive: true });

  try {
    let writtenBytes = 0;
    for (const entry of entries) {
      const path = relativePath(paths.get(entry)!);
      if (!path) continue;
      const destination = await join(staging, ...path.split('/'));
      if (entry.dir) {
        await mkdir(destination, { recursive: true });
        continue;
      }
      const contents = await entry.async('uint8array');
      writtenBytes += contents.byteLength;
      if (writtenBytes > MAX_PACKAGE_BYTES) throw new Error('The uncompressed agent package is too large (maximum 100 MB).');
      await mkdir(await dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }
    await rename(staging, target);
  } catch (error) {
    if (await exists(staging)) await remove(staging, { recursive: true });
    throw error;
  }
  return selected.definition;
}

async function removeEmptyAgentDirectories(path: string): Promise<void> {
  const agentsRoot = await join(await appDataDir(), 'agents');
  const normalizedRoot = agentsRoot.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  let directory = await dirname(path);
  let normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();

  while (normalizedDirectory.startsWith(`${normalizedRoot}/`)) {
    if ((await readDir(directory)).length > 0) break;
    await remove(directory);
    const parent = await dirname(directory);
    if (parent === directory) break;
    directory = parent;
    normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  }
}

export async function saveEditedAgent(current: AvailableAgent, definition: AgentDefinition): Promise<void> {
  const agents = await listAvailableAgents();
  const duplicate = agents.find(
    (agent) => agent.path !== current.path && agent.agentName.toLocaleLowerCase() === definition.agentName.toLocaleLowerCase(),
  );
  if (duplicate) throw new Error(`Another agent named “${duplicate.agentName}” is already installed.`);

  const root = await join(await appDataDir(), 'agents');
  const nextPath = await getAgentPath(definition.agentName);
  const currentDirectory = await dirname(current.path);
  const nextDirectory = await dirname(nextPath);
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  const normalizedCurrentDirectory = currentDirectory.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  const isAgentPackageDirectory = (await dirname(currentDirectory)).replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase() === normalizedRoot;
  const movePackage = isAgentPackageDirectory && normalizedCurrentDirectory !== nextDirectory.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();

  if (movePackage && await exists(nextDirectory)) throw new Error('Another agent package already exists at the new location.');
  if (!movePackage && nextPath !== current.path && await exists(nextPath)) {
    throw new Error('Another file already exists at the new agent location.');
  }

  let moved = false;
  try {
    if (movePackage) {
      await rename(currentDirectory, nextDirectory);
      moved = true;
    }
    await mkdir(nextDirectory, { recursive: true });
    await writeTextFile(nextPath, JSON.stringify(definition, null, 2));
    const oldDefinitionPath = moved ? await join(nextDirectory, current.path.split(/[\\/]/).pop()!) : current.path;
    if (oldDefinitionPath !== nextPath) await remove(oldDefinitionPath);
  } catch (error) {
    if (moved && await exists(nextDirectory) && !(await exists(currentDirectory))) {
      await rename(nextDirectory, currentDirectory);
    }
    throw error;
  }
  if (!moved && nextPath !== current.path) await removeEmptyAgentDirectories(current.path);
}

export async function exportAgentPackage(agent: AvailableAgent): Promise<Uint8Array> {
  const zip = new JSZip();
  const directory = await dirname(agent.path);
  const agentsRoot = await join(await appDataDir(), 'agents');
  const isPackage = (await dirname(directory)).replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase()
    === agentsRoot.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();

  const addDirectory = async (current: string, relative: string): Promise<void> => {
    for (const entry of await readDir(current)) {
      const source = await join(current, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        zip.folder(name);
        await addDirectory(source, name);
      } else if (entry.isFile) {
        zip.file(name, await readFile(source));
      }
    }
  };

  if (isPackage) await addDirectory(directory, '');
  else zip.file(agent.path.split(/[\\/]/).pop() || 'agent.json', await readFile(agent.path));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function deleteAgentDefinition(agent: AvailableAgent): Promise<void> {
  const root = await join(await appDataDir(), 'agents');
  const directory = await dirname(agent.path);
  const parent = await dirname(directory);
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  const normalizedParent = parent.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase();
  if (normalizedParent === normalizedRoot) {
    // Imported packages keep all their supporting files beside the definition.
    await remove(directory, { recursive: true });
    return;
  }
  await remove(agent.path);
  await removeEmptyAgentDirectories(agent.path);
}