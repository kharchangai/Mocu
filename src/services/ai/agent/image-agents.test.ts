import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, BaseMessage } from '@langchain/core/messages';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), llm: vi.fn(),
}));
vi.mock('../llm', () => ({
  getMainAgentLlm: mocks.llm,
  getSelectedChatModel: () => 'custom-vision',
  getSelectedChatReasoningEffort: () => null,
}));
vi.mock('../model-stream', () => ({ streamChatModelWithTrace: mocks.stream }));
vi.mock('../model-catalog', async (original) => ({
  ...await original<typeof import('../model-catalog')>(),
  listGatewayModels: async () => [{ id: 'custom-vision', supportsImages: true }],
}));
vi.mock('../../../chat/services/agentTrace', () => ({
  createAgentModelTrace: () => ({ begin: vi.fn(), onThinking: vi.fn(), onText: vi.fn(), finish: vi.fn() }),
}));
vi.mock('../../../chat/components/skills/selected-skill-loader', () => ({
  resolveSelectedSkills: async () => ({ skills: [], missingSkills: [], skillsPrompt: '' }),
}));
vi.mock('../../../extensions/services/extension-agent-tools', () => ({
  loadExtensionAgentTools: async () => ({ tools: [], entries: [], missingExtensions: [], prompt: '', registerAll: vi.fn() }),
}));
vi.mock('../../../mcp/tool-adapter', () => ({
  loadMcpAgentTools: async () => ({ tools: [], entries: [], unresolved: [], prompt: '', registerAll: vi.fn() }),
}));
vi.mock('../../../chat/agent/agent-tools', () => ({
  loadAgentTools: async () => ({ tools: [], entries: [], missingAgents: [], prompt: '', registerAll: vi.fn() }),
}));
vi.mock('./user-memory', () => ({
  getPreviousConversationTurn: () => null,
  retrieveUserMemory: async () => null,
  buildUserMemoryPrompt: () => '',
  saveUserMemoryInBackground: vi.fn(),
}));
vi.mock('../../../chat/project/memory/memory-retrieval/memoryRetrievalPipeline', () => ({
  retrieveProjectMemory: async () => null,
  buildProjectMemoryPrompt: () => '',
}));
vi.mock('../../../chat/docs', () => ({ buildDocsContextPrompt: async () => '' }));
vi.mock('../../../chat/notes', () => ({ buildNotesContextPrompt: async () => '' }));
vi.mock('../focus/focusManager', () => ({
  hasActiveFocusSession: async () => false, parseFocusStartGoal: () => null,
}));
vi.mock('../stepbystep/workflowManager', () => ({ hasActiveStepWorkflow: async () => false }));
vi.mock('../specialistCommands', () => ({ runSpecialistSlashCommand: async () => null }));
vi.mock('../../../graphStructure/graphSearch', () => ({ searchRunGraphs: async () => ({ matches: [], totalGraphs: 0, query: '', scoring: 'none' }) }));
vi.mock('../../../graphStructure/graphDigest', () => ({ searchRunGraphHints: async () => '', createGraphDigestTool: () => ({ name: 'get_relevant_run_graph_digest', description: '', runnable: { name: 'get_relevant_run_graph_digest' }, execute: async () => '' }), createGraphToolLogTool: () => ({ name: 'get_run_graph_tool_log', description: '', runnable: { name: 'get_run_graph_tool_log' }, execute: async () => '' }) }));
vi.mock('../../../graphStructure/recorder', () => ({ createGraphRecorder: () => ({ startRun() {}, getRecords: () => [], finishRun() {}, recordModelCall() {}, recordToolCall() {}, runId: 'test-run', agentKind: 'project', chatId: 'test-chat' }) }));

import { callChatAgent } from '../chat-agent';
import { callProjectAgent } from '../project-agent';
import { buildHumanMessageFromRequest, buildHumanMessageWithImages, hasImageInput } from './image-content';
import { FocusExecutor } from '../focus/FocusExecutor';
import { StepExecutor } from '../stepbystep/StepExecutor';

beforeEach(() => {
  mocks.stream.mockReset().mockResolvedValue(new AIMessage('I can see the images.'));
  mocks.llm.mockReset().mockResolvedValue({ model: 'custom-vision', bindTools: () => ({}) });
});

const attachments = Array.from({ length: 3 }, (_, i) => ({
  id: String(i), name: `${i}.jpg`, mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${i}`,
}));
const config = { configurable: { suppressMemorySave: true } };

describe.each(['chat', 'project'] as const)('%s agent image input', (kind) => {
  it.each(['Compare the images.', ''])('retains all images in the actual model call (text: %s)', async (text) => {
    const input = buildHumanMessageWithImages(text, attachments);
    const state = { messages: [input], memoryContext: '' };
    const result = kind === 'chat'
      ? await callChatAgent(state, config)
      : await callProjectAgent(state, 'E:\\demo', config);
    expect(result.messages[0].content).toBe('I can see the images.');
    const sent = mocks.stream.mock.calls[0][0].messages as BaseMessage[];
    const content = sent[sent.length - 1].content;
    expect(content).toEqual([
      { type: 'text', text: text || 'Describe the attached images.' },
      ...attachments.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ]);
  });
  it('keeps images in the final answer request after using tools', async () => {
    mocks.stream.mockReset()
      .mockResolvedValueOnce(new AIMessage({ content: '', tool_calls: [{ id: 'call-1', name: 'speech_control', args: { action: 'invalid' } }] }))
      .mockResolvedValueOnce(new AIMessage('Tool handled.'))
      .mockResolvedValueOnce(new AIMessage('Final image answer.'));
    const state = { messages: [buildHumanMessageWithImages('Inspect these.', attachments)], memoryContext: '' };
    const result = kind === 'chat'
      ? await callChatAgent(state, config)
      : await callProjectAgent(state, 'E:\\demo', config);
    expect(result.messages[0].content).toBe('Final image answer.');
    expect(mocks.stream).toHaveBeenCalledTimes(3);
    const finalMessages = mocks.stream.mock.calls[2][0].messages as BaseMessage[];
    const content = finalMessages[finalMessages.length - 1].content as Array<{ type: string }>;
    expect(content.filter((part) => part.type === 'image_url')).toHaveLength(3);
  });
  it('forwards text and attached images through the shared specialist message builder', () => {
    const source = buildHumanMessageWithImages('Inspect these', attachments);
    const focusMessages = [buildHumanMessageFromRequest('Inspect these', source)];
    const stepMessages = [buildHumanMessageFromRequest('Inspect these', source)];
    for (const messages of [focusMessages, stepMessages]) {
      expect(hasImageInput(messages[0])).toBe(true);
      expect(messages[0].content).toEqual([
        { type: 'text', text: 'Inspect these' },
        ...attachments.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
      ]);
    }
    expect(FocusExecutor).toBeDefined();
    expect(StepExecutor).toBeDefined();
  });
});
