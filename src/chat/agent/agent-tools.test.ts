import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAvailableAgent: vi.fn(),
  runAgent: vi.fn(),
}));

vi.mock('./agent-loader', () => ({ findAvailableAgent: mocks.findAvailableAgent }));
vi.mock('./agent-runner', () => ({ runAgent: mocks.runAgent }));

import { loadAgentTools } from './agent-tools';

const savedAgent = {
  agentName: 'Writer',
  description: 'Drafts and edits concise product copy.',
  mainInstruction: 'Write clear, accurate copy.',
  agents: [],
  skills: [],
  tools: [],
  extensions: [],
  llm: null,
  id: 'Writer',
  path: 'C:/app/agents/Writer/Writer.json',
};

describe('selected specialist agent tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findAvailableAgent.mockResolvedValue(savedAgent);
    mocks.runAgent.mockResolvedValue('Draft completed.');
  });

  it('gives the main agent the saved description and delegation guidance', async () => {
    const tools = await loadAgentTools(['Writer']);

    expect(tools.prompt).toContain(savedAgent.description);
    expect(tools.prompt).toContain('You remain the primary agent');
    expect(tools.prompt).toContain('specific, bounded, self-contained assignment');
    expect(tools.prompt).toContain('synthesize the final answer');
    expect(tools.tools[0].description).toContain(savedAgent.description);
  });

  it('forwards the main agent assignment, not an implicitly substituted user message', async () => {
    const tools = await loadAgentTools(['Writer'], 'E:/project');
    const assignment = 'Draft three concise product taglines for the launch page.';

    await tools.tools[0].invoke({ request: assignment });

    expect(mocks.runAgent).toHaveBeenCalledWith(expect.objectContaining({
      agent: savedAgent,
      userMessage: assignment,
      projectPath: 'E:/project',
    }));
  });
});
