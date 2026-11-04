import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage, mapChatMessagesToStoredMessages } from '@langchain/core/messages';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), llm: vi.fn(), retrieveProjectMemory: vi.fn(), projectHistoryFinishError: null as Error | null,
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
  retrieveProjectMemory: mocks.retrieveProjectMemory,
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
vi.mock('../project-history', () => ({
  withProjectHistorySession: async (_path: string, run: () => Promise<unknown>, onFinishError?: (error: unknown) => void) => {
    const result = await run();
    if (mocks.projectHistoryFinishError) onFinishError?.(mocks.projectHistoryFinishError);
    return result;
  },
  createProjectHistoryTools: () => ({
    history: { name: 'project_history', description: '', invoke: vi.fn() },
    fileHistory: { name: 'project_file_history', description: '', invoke: vi.fn() },
    restore: { name: 'restore_project_file', description: '', invoke: vi.fn() },
  }),
  prepareProjectFileRestore: vi.fn(),
  applyProjectFileRestore: vi.fn(),
}));

import { callChatAgent } from '../chat-agent';
import { callProjectAgent } from '../project-agent';
import type { ProjectAgentResumeSnapshot } from '../projectAgentResume';
import { buildHumanMessageFromRequest, buildHumanMessageWithImages, hasImageInput } from './image-content';
import { FocusExecutor } from '../focus/FocusExecutor';
import { StepExecutor } from '../stepbystep/StepExecutor';

beforeEach(() => {
  mocks.stream.mockReset().mockResolvedValue(new AIMessage('I can see the images.'));
  mocks.llm.mockReset().mockResolvedValue({ model: 'custom-vision', clientConfig: { baseURL: 'https://gateway.example/v1' }, bindTools: vi.fn(() => ({})) });
  mocks.retrieveProjectMemory.mockReset().mockResolvedValue(emptyProjectMemory);
  mocks.projectHistoryFinishError = null;
});

const attachments = Array.from({ length: 3 }, (_, i) => ({
  id: String(i), name: `${i}.jpg`, mimeType: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${i}`,
}));
const config = { configurable: { suppressMemorySave: true } };
const emptyProjectMemory = {
  memoryRequired: false,
  gateDecision: { memoryRequired: false, confidence: 1, reason: 'test' },
  relatedTurns: [],
  temporalMemory: null,
  graphMemoryContext: '',
  memoryContext: '',
  estimatedTokens: 0,
};

describe('project agent post-response memory diagnostics', () => {
  it('returns the completed answer and carries temporal-memory warnings to the caller', async () => {
    const warning = 'Some temporal project memory could not be retrieved; the answer may not include that stored context.';
    mocks.retrieveProjectMemory.mockResolvedValue({
      memoryRequired: true,
      gateDecision: { memoryRequired: true, confidence: 1, reason: 'test' },
      relatedTurns: [],
      temporalMemory: null,
      graphMemoryContext: '',
      memoryContext: '',
      warnings: [warning],
      estimatedTokens: 0,
    });
    mocks.stream.mockReset().mockResolvedValue(new AIMessage('The task is complete.'));

    const result = await callProjectAgent({
      messages: [new HumanMessage('Do the task.')],
      memoryContext: '',
    }, 'E:\\demo', config);
    const answer = result.messages[result.messages.length - 1];

    expect(answer.content).toBe('The task is complete.');
    expect(answer.additional_kwargs.mocuPostResponseWarnings).toEqual([warning]);
  });

  it('keeps the final answer when graph-memory persistence fails', async () => {
    const recorderModule = await import('../../../graphStructure/recorder');
    const originalCreateRecorder = recorderModule.createGraphRecorder;
    vi.spyOn(recorderModule, 'createGraphRecorder').mockReturnValue({
      startRun() {},
      getRecords() { throw new Error('graph recorder failed'); },
      finishRun() {},
      recordModelCall() {},
      recordToolCall() {},
      runId: 'test-run',
      agentKind: 'project',
      chatId: 'test-chat',
    } as never);
    mocks.retrieveProjectMemory.mockResolvedValue(emptyProjectMemory);
    mocks.stream.mockReset().mockResolvedValue(new AIMessage('The answer remains complete.'));

    const result = await callProjectAgent({
      messages: [new HumanMessage('Complete the work.')],
      memoryContext: '',
    }, 'E:\\demo', config);
    const answer = result.messages[result.messages.length - 1];

    expect(answer.content).toBe('The answer remains complete.');
    expect(answer.additional_kwargs.mocuPostResponseWarnings).toEqual([
      'The answer is complete, but saving this run to project graph memory failed.',
    ]);
    vi.spyOn(recorderModule, 'createGraphRecorder').mockRestore();
    expect(originalCreateRecorder).toBeDefined();
  });

  it('keeps the final answer when the project-history final checkpoint fails', async () => {
    mocks.retrieveProjectMemory.mockResolvedValue(emptyProjectMemory);
    mocks.projectHistoryFinishError = new Error('checkpoint write failed');
    mocks.stream.mockReset().mockResolvedValue(new AIMessage('The completed answer.'));

    const result = await callProjectAgent({
      messages: [new HumanMessage('Finish the task.')],
      memoryContext: '',
    }, 'E:\\demo', config);
    const answer = result.messages[result.messages.length - 1];

    expect(answer.content).toBe('The completed answer.');
    expect(answer.additional_kwargs.mocuPostResponseWarnings).toEqual([
      'The answer is complete, but saving the final project-history checkpoint failed.',
    ]);
  });

  it('resumes from the exact saved model conversation and appends new user guidance', async () => {
    const savedMessages = [
      new SystemMessage('Original system prompt and retrieved context.'),
      new HumanMessage('Build the feature.'),
      new AIMessage({
        content: 'I inspected the project.',
        tool_calls: [{ id: 'saved-call-1', name: 'terminal_executor', args: { command: 'Get-ChildItem' }, type: 'tool_call' }],
      }),
      new ToolMessage({ content: 'Found the application files.', tool_call_id: 'saved-call-1', name: 'terminal_executor' }),
    ];
    const snapshot: ProjectAgentResumeSnapshot = {
      version: 1,
      projectPath: 'E:\\demo',
      originalUserPrompt: 'Build the feature.',
      latestUserPrompt: 'Build the feature.',
      modelId: 'saved-model',
      gatewayBaseUrl: 'https://saved-gateway.example/v1',
      messages: mapChatMessagesToStoredMessages(savedMessages),
      toolDefinitions: [{ type: 'function', function: { name: 'terminal_executor', parameters: { type: 'object' } } }],
      configurable: {
        selectedSkills: [],
        selectedExtensions: [],
        selectedMcpServers: [],
        selectedAgent: null,
        selectedModel: 'saved-model',
        reasoningEffort: 'high',
        projectDescription: 'Original description.',
      },
    };
    mocks.stream.mockReset().mockResolvedValue(new AIMessage('Resumed answer.'));

    await callProjectAgent({
      messages: [new HumanMessage('Also add a regression test.')],
      memoryContext: '',
    }, 'E:\\different-project', {
      configurable: {
        ...config.configurable,
        projectAgentResumeSnapshot: snapshot,
        projectAgentResumeHasNewMessage: true,
      },
    });

    const modelMessages = mocks.stream.mock.calls[0][0].messages as BaseMessage[];
    expect(modelMessages.slice(0, savedMessages.length).map((message) => message.toDict()))
      .toEqual(savedMessages.map((message) => message.toDict()));
    expect(modelMessages[modelMessages.length - 1]?.content).toBe('Also add a regression test.');
    expect(mocks.llm.mock.calls[0][0]).toBe('saved-model');
    expect(mocks.llm.mock.calls[0][1]).toEqual({
      reasoningEffort: 'high',
      baseUrl: 'https://saved-gateway.example/v1',
    });
    const boundModel = await mocks.llm.mock.results[0].value;
    expect(boundModel.bindTools).toHaveBeenCalledWith(snapshot.toolDefinitions);

    mocks.stream.mockReset().mockResolvedValue(new AIMessage('Continued from the checkpoint.'));
    await callProjectAgent({
      messages: [new HumanMessage('Build the feature.')],
      memoryContext: '',
    }, snapshot.projectPath, {
      configurable: {
        projectAgentResumeSnapshot: snapshot,
        projectAgentResumeHasNewMessage: false,
      },
    });
    const exactResumeMessages = mocks.stream.mock.calls[0][0].messages as BaseMessage[];
    expect(exactResumeMessages.map((message) => message.toDict()))
      .toEqual(savedMessages.map((message) => message.toDict()));
  });
});

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
    expect(result.messages[0].content).toBe(kind === 'chat' ? 'Final image answer.' : 'Tool handled.');
    expect(mocks.stream).toHaveBeenCalledTimes(kind === 'chat' ? 3 : 2);
    const finalMessages = mocks.stream.mock.calls[kind === 'chat' ? 2 : 1][0].messages as BaseMessage[];
    const imageMessage = kind === 'chat'
      ? finalMessages[finalMessages.length - 1]
      : finalMessages.find((message) => message.getType() === 'human');
    const content = imageMessage?.content as Array<{ type: string }>;
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
