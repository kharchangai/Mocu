import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeFile, writeTextFile, appDataDir, dirname, join, listAvailableAgents } = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
  appDataDir: vi.fn(),
  dirname: vi.fn(),
  join: vi.fn(),
  listAvailableAgents: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  writeFile,
  writeTextFile,
}));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir, dirname, join }));
vi.mock('./agent-loader', () => ({ listAvailableAgents }));

import { deleteAgentDefinition, installAgentPackage, saveEditedAgent } from './agent-storage';

const agent = {
  agentName: 'Writer',
  description: 'Writes drafts',
  mainInstruction: 'Write clear drafts.',
  agents: [],
  skills: [],
  tools: [],
  extensions: [],
  llm: null,
  id: 'Writer',
  path: 'C:/app/agents/Writer/Writer.json',
};

function parentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(0, index);
}

describe('agent storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appDataDir.mockResolvedValue('C:/app');
    join.mockImplementation(async (...parts: string[]) => parts.join('/'));
    dirname.mockImplementation(async (path: string) => parentPath(path));
    readDir.mockResolvedValue([]);
    remove.mockResolvedValue(undefined);
    rename.mockResolvedValue(undefined);
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    writeTextFile.mockResolvedValue(undefined);
    listAvailableAgents.mockResolvedValue([agent]);
  });

  it('deletes the entire agent package folder, including supporting files', async () => {
    await deleteAgentDefinition(agent);

    expect(remove).toHaveBeenCalledWith('C:/app/agents/Writer', { recursive: true });
  });

  it('moves the saved definition and its package folder when the agent is renamed', async () => {
    const renamed = { ...agent, agentName: 'Code Manager' };

    await saveEditedAgent(agent, {
      agentName: renamed.agentName,
      description: renamed.description,
      mainInstruction: renamed.mainInstruction,
      agents: renamed.agents,
      skills: renamed.skills,
      tools: renamed.tools,
      extensions: renamed.extensions,
      llm: renamed.llm,
    });

    expect(rename).toHaveBeenCalledWith('C:/app/agents/Writer', 'C:/app/agents/Code Manager');
    expect(writeTextFile).toHaveBeenCalledWith(
      'C:/app/agents/Code Manager/Code Manager.json',
      expect.stringContaining('"agentName": "Code Manager"'),
    );
    expect(remove.mock.calls).toEqual([['C:/app/agents/Code Manager/Writer.json']]);
  });

  it('installs a ZIP agent package and preserves supporting files', async () => {
    const zip = new JSZip();
    zip.file('Agent.json', JSON.stringify({ agentName: 'Analyst', mainInstruction: 'Analyze carefully.' }));
    zip.file('prompts/review.md', 'Review checklist');
    zip.file('settings/config.json', JSON.stringify({ mode: 'strict' }));
    readFile.mockResolvedValue(await zip.generateAsync({ type: 'uint8array' }));
    listAvailableAgents.mockResolvedValue([]);

    const installed = await installAgentPackage('C:/downloads/analyst.zip');

    expect(installed.agentName).toBe('Analyst');
    expect(writeFile).toHaveBeenCalledWith(expect.stringMatching(/C:\/app\/agents\/.agent-install-[^/]+\/prompts\/review\.md/), expect.any(Uint8Array));
    expect(writeFile).toHaveBeenCalledWith(expect.stringMatching(/C:\/app\/agents\/.agent-install-[^/]+\/settings\/config\.json/), expect.any(Uint8Array));
    expect(rename).toHaveBeenCalledWith(expect.stringMatching(/C:\/app\/agents\/.agent-install-/), 'C:/app/agents/Analyst');
  });
});