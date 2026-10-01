import {
  Annotation,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';

import { getAsyncLLM, getAsyncLLMByModel } from '../../services/ai/llm';
import {
  dispatchAgentActivity,
  getTextContent,
  getToolResultText,
} from '../../services/ai/agent/helpers';
import { dispatchAgentToolActivity, getChatIdFromConfig } from '../services/toolActivity';
import { createAgentModelTrace } from '../services/agentTrace';
import { streamChatModelWithTrace } from '../../services/ai/model-stream';
import { isAbortError, throwIfAborted } from '../../services/ai/agent/abort';
import { ToolExecutor } from '../../services/ai/agent/tool-executor';
import { terminalExecutionTool } from '../../services/ai/tools/terminal_execution_tool';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  findFileTool,
} from '../../services/ai/tools/filesystem';
import { docTools } from '../../services/ai/tools/docs_tools';
import { notesTools } from '../../services/ai/tools/notes_tools';
import { perplexitySearchTool } from '../../services/ai/tools/perplexity_search_tool';
import { skillLoaderTool } from '../../services/ai/tools/skill_loader_tool';
import { AGENT_TOOL_CATALOG, type AgentToolName } from './agent-tool-catalog';
import { resolveSelectedSkills } from '../components/skills/selected-skill-loader';
import { loadExtensionAgentTools } from '../../extensions/services/extension-agent-tools';
import { scanInstalledExtensions } from '../../extensions/services/extension-scanner';
import {
  scheduleTool,
  type ScheduleActionInput,
} from '../../schedule/schedule-tool';
import { loadMcpAgentTools } from '../../mcp/tool-adapter';
import { findAvailableAgent, type AvailableAgent } from './agent-loader';

type ToolArgs = Record<string, unknown>;

const FILESYSTEM_TOOLS: StructuredToolInterface[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  findFileTool,
];
const DOCUMENT_TOOLS: StructuredToolInterface[] = [...docTools];
const NOTE_TOOLS: StructuredToolInterface[] = [...notesTools];

type AgentRunInput = {
  agent: AvailableAgent;
  userMessage: string;
  projectPath: string;
  config?: RunnableConfig;
};

type AgentState = {
  messages: BaseMessage[];
};

const AgentGraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

/**
 * Runs one saved agent through a small LangGraph workflow.
 * The graph intentionally has one orchestration node that owns the model/tool loop.
 */
export async function runAgent(input: AgentRunInput): Promise<string> {
  const userMessage = input.userMessage.trim();
  if (!userMessage) {
    throw new Error('An agent requires a non-empty user message.');
  }

  const graph = new StateGraph(AgentGraphState)
    .addNode('run_agent', async (state, config) => ({
      messages: [await runAgentNode(input, state, config)],
    }))
    .addEdge(START, 'run_agent')
    .addEdge('run_agent', END)
    .compile();

  const result = await graph.invoke(
    { messages: [new HumanMessage(userMessage)] },
    input.config,
  );

  const response = result.messages[result.messages.length - 1];
  return response ? getTextContent(response.content).trim() : '';
}

/** Runs an agent selected by name. This is the entry point used by Mocu. */
export async function runAgentByName(
  name: string,
  userMessage: string,
  projectPath: string,
  config?: RunnableConfig,
): Promise<string> {
  const agent = await findAvailableAgent(name);
  if (!agent) {
    throw new Error(`Agent "${name}" was not found in the agents folder.`);
  }
  return runAgent({ agent, userMessage, projectPath, config });
}

async function runAgentNode(
  input: AgentRunInput,
  _state: AgentState,
  config?: RunnableConfig,
): Promise<AIMessage> {
  const runnableConfig = config ?? input.config ?? {};
  const signal = runnableConfig.signal;
  throwIfAborted(signal);

  const normalizedProjectPath = input.projectPath.trim();
  const selectedSkills = await resolveSelectedSkills(
    mergeReferences(
      input.agent.skills,
      getConfigReferences(runnableConfig, 'selectedSkills'),
    ),
  );
  throwIfAborted(signal);

  const extensionIds = await resolveExtensionIds(
    mergeReferences(
      input.agent.extensions,
      getConfigReferences(runnableConfig, 'selectedExtensions'),
    ),
  );
  const extensionTools = await loadExtensionAgentTools(extensionIds);
  throwIfAborted(signal);

  /* MCP tools remain request-scoped and are not inherited just from being connected. */
  const mcpSelections = getConfigReferences(runnableConfig, 'selectedMcpServers')
    .map((serverId) => ({ serverId }));
  const mcpTools = await loadMcpAgentTools(mcpSelections);
  throwIfAborted(signal);
  if (mcpTools.unresolved.length > 0) {
    console.warn(
      '[Agent Runner] Selected MCP servers/tools unavailable (not connected or unknown):',
      mcpTools.unresolved,
    );
  }

  const terminalTool = terminalExecutionTool({
    ...(normalizedProjectPath ? { projectPath: normalizedProjectPath } : {}),
  });
  const childAgents = await createChildAgentTools(input, runnableConfig);
  const explicitlyConfiguredTools = input.agent.toolSelectionConfigured === true;
  const selectedBuiltInTools = new Set(input.agent.tools);
  const includeTool = (name: AgentToolName) =>
    !explicitlyConfiguredTools || selectedBuiltInTools.has(name);
  const selectedFilesystemTools = includeTool('filesystem') ? FILESYSTEM_TOOLS : [];
  const selectedDocumentTools = includeTool('documents') ? DOCUMENT_TOOLS : [];
  const selectedNoteTools = includeTool('notes') ? NOTE_TOOLS : [];

  const bindableTools: StructuredToolInterface[] = [
    ...(includeTool('terminal_executor') ? [terminalTool] : []),
    ...selectedFilesystemTools,
    ...selectedDocumentTools,
    ...selectedNoteTools,
    ...(includeTool('perplexity_search') ? [perplexitySearchTool] : []),
    ...(includeTool('load_skill') ? [skillLoaderTool] : []),
    ...(includeTool('schedule_action') ? [scheduleTool] : []),
    ...extensionTools.tools,
    ...mcpTools.tools,
    ...childAgents.tools,
  ];

  const executor = new ToolExecutor();
  if (includeTool('terminal_executor')) {
    executor.registerTool({
      name: 'terminal_executor',
      description: terminalTool.description,
      execute: (args) => terminalTool.invoke(args as { command: string }, runnableConfig),
    });
  }
  if (includeTool('perplexity_search')) {
    executor.registerTool({
      name: 'perplexity_search',
      description: perplexitySearchTool.description,
      execute: (args) => perplexitySearchTool.invoke(args as { query: string }, runnableConfig),
    });
  }
  if (includeTool('load_skill')) {
    executor.registerTool({
      name: 'load_skill',
      description: skillLoaderTool.description,
      execute: (args) => skillLoaderTool.invoke(args as { skillName: string }, runnableConfig),
    });
  }
  if (includeTool('schedule_action')) {
    executor.registerTool({
      name: 'schedule_action',
      description: scheduleTool.description,
      execute: (args) => scheduleTool.invoke(args as ScheduleActionInput, runnableConfig),
    });
  }
  registerStructuredTools(
    executor,
    [...selectedFilesystemTools, ...selectedDocumentTools, ...selectedNoteTools],
    runnableConfig,
  );
  extensionTools.registerAll(executor);
  mcpTools.registerAll(executor);
  childAgents.registerAll(executor);

  const systemPrompt = buildAgentSystemPrompt(
    input.agent,
    normalizedProjectPath,
    selectedSkills.skillsPrompt,
    extensionTools.prompt,
    mcpTools.prompt,
    childAgents.prompt,
  );
  const llm = input.agent.llm
    ? await getAsyncLLMByModel(input.agent.llm)
    : await getAsyncLLM('expensive');
  const llmWithTools = llm.bindTools(bindableTools);
  let messages: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    new HumanMessage(input.userMessage.trim()),
  ];
  const initialModelTrace = createAgentModelTrace(getChatIdFromConfig(runnableConfig));
  let response = await streamChatModelWithTrace({
    model: llmWithTools,
    messages,
    config: runnableConfig,
    handlers: {
      onStart: initialModelTrace.begin,
      onThinking: initialModelTrace.onThinking,
      onText: initialModelTrace.onText,
    },
  });
  initialModelTrace.finish({ hasToolCalls: Boolean(response.tool_calls?.length) });
  const toolResults: string[] = [];

  while (response.tool_calls?.length) {
    throwIfAborted(signal);
    const toolMessages: ToolMessage[] = [];

    for (const toolCall of response.tool_calls) {
      const toolCallId = toolCall.id;
      if (!toolCallId) throw new Error(`Missing tool call ID for ${toolCall.name}.`);

      let result = '';
      let toolFailed = false;
      const ownerChatId = getChatIdFromConfig(runnableConfig);
      dispatchAgentActivity(toolCall.name);
      dispatchAgentToolActivity({
        id: toolCallId,
        tool: toolCall.name,
        args: (toolCall.args ?? {}) as ToolArgs,
        status: 'running',
        chatId: ownerChatId,
      });
      try {
        result = getToolResultText(
          await executor.execute(
            toolCall.name,
            (toolCall.args ?? {}) as ToolArgs,
            { toolCallId, toolName: toolCall.name, chatId: ownerChatId },
          ),
        ).trim();
      } catch (error) {
        if (isAbortError(error)) throw error;
        console.error(`[Agent Runner] Tool ${toolCall.name} failed:`, error);
        toolFailed = true;
        result = `The tool ${toolCall.name} failed.`;
      } finally {
        dispatchAgentActivity(null);
      }

      result ||= 'The tool completed without a result.';
      dispatchAgentToolActivity({
        id: toolCallId,
        tool: toolCall.name,
        args: (toolCall.args ?? {}) as ToolArgs,
        result,
        status: toolFailed ? 'error' : 'done',
        chatId: ownerChatId,
      });
      toolResults.push(`[${toolCall.name}]\n${result}`);
      toolMessages.push(new ToolMessage({
        content: result,
        tool_call_id: toolCallId,
        name: toolCall.name,
      }));
    }

    messages = [...messages, response, ...toolMessages];
    const stepModelTrace = createAgentModelTrace(getChatIdFromConfig(runnableConfig));
    response = await streamChatModelWithTrace({
      model: llmWithTools,
      messages,
      config: runnableConfig,
      handlers: {
        onStart: stepModelTrace.begin,
        onThinking: stepModelTrace.onThinking,
        onText: stepModelTrace.onText,
      },
    });
    stepModelTrace.finish({ hasToolCalls: Boolean(response.tool_calls?.length) });
  }

  if (toolResults.length > 0) {
    const finalLlm = input.agent.llm
      ? await getAsyncLLMByModel(input.agent.llm)
      : await getAsyncLLM('expensive');
    const finalTrace = createAgentModelTrace(
      getChatIdFromConfig(runnableConfig),
      { mode: 'answer' },
    );
    response = await streamChatModelWithTrace({
      model: finalLlm,
      messages: [
        new SystemMessage(systemPrompt),
        new HumanMessage(
          `${input.userMessage.trim()}\n\nTOOL RESULTS\n${toolResults.join('\n\n')}\n\nGive the final answer for the user.`,
        ),
      ],
      config: runnableConfig,
      handlers: {
        onStart: finalTrace.begin,
        onThinking: finalTrace.onThinking,
        onText: finalTrace.onText,
      },
    });
    finalTrace.finish({ hasToolCalls: false });
  }

  throwIfAborted(signal);
  return response;
}

function buildAgentSystemPrompt(
  agent: AvailableAgent,
  projectPath: string,
  skillsPrompt: string,
  extensionsPrompt: string,
  mcpToolsPrompt: string,
  childAgentsPrompt: string,
): string {
  return [
    `You are the specialist agent "${agent.agentName}" inside Mocu.`,
    'Complete the user request by following the saved instruction below.',
    'Return a useful result to the main Mocu agent; do not discuss this orchestration unless asked.',
    '',
    'SAVED AGENT INSTRUCTION',
    agent.mainInstruction,
    '',
    'PROJECT PATH',
    projectPath || 'No project folder was selected.',
    '',
    skillsPrompt.trim(),
    extensionsPrompt.trim(),
    mcpToolsPrompt.trim(),
    childAgentsPrompt.trim(),
    '',
    'AVAILABLE TOOLS',
    getConfiguredToolNames(agent).length > 0
      ? `Only use the following built-in tools, which are enabled for this agent: ${getConfiguredToolNames(agent).join(', ')}.`
      : 'No built-in tools were selected for this agent. Use only its configured child agents, selected extension tools, selected MCP tools, or skill-loading support when available.',
    agent.agents.length > 0 && childAgentsPrompt
      ? `CONFIGURED CHILD AGENTS: ${agent.agents.join(', ')}`
      : '',
    mcpToolsPrompt.trim()
      ? 'Selected MCP tools are available for this request.'
      : 'No MCP tools are selected for this request.',
  ].filter((part, index) => index < 8 || part.trim()).join('\n');
}

function getConfiguredToolNames(agent: AvailableAgent): string[] {
  const configuredNames = agent.toolSelectionConfigured !== true
    ? AGENT_TOOL_CATALOG.map((availableTool) => availableTool.name)
    : agent.tools.filter((name): name is AgentToolName =>
        AGENT_TOOL_CATALOG.some((availableTool) => availableTool.name === name),
      );

  return configuredNames.flatMap((name) => {
    if (name === 'filesystem') return FILESYSTEM_TOOLS.map((item) => item.name);
    if (name === 'documents') return DOCUMENT_TOOLS.map((item) => item.name);
    if (name === 'notes') return NOTE_TOOLS.map((item) => item.name);
    return [name];
  });
}

function registerStructuredTools(
  executor: ToolExecutor,
  tools: StructuredToolInterface[],
  config: RunnableConfig,
): void {
  for (const agentTool of tools) {
    executor.registerTool({
      name: agentTool.name,
      description: agentTool.description,
      execute: (args) => agentTool.invoke(args as never, config),
    });
  }
}

function getConfigReferences(config: RunnableConfig, key: string): string[] {
  const value = config.configurable?.[key];
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];
}

function mergeReferences(...groups: string[][]): string[] {
  const values = new Map<string, string>();
  for (const group of groups) {
    for (const value of group) {
      const normalized = value.trim();
      if (normalized && !values.has(normalized.toLowerCase())) {
        values.set(normalized.toLowerCase(), normalized);
      }
    }
  }
  return [...values.values()];
}

async function resolveExtensionIds(references: string[]): Promise<string[]> {
  const normalized = references.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) return [];

  try {
    const installed = await scanInstalledExtensions();
    return normalized.map((reference) => {
      const match = installed.find(
        (extension) =>
          extension.manifest.id.toLowerCase() === reference.toLowerCase() ||
          extension.manifest.name.toLowerCase() === reference.toLowerCase(),
      );
      return match?.manifest.id ?? reference;
    });
  } catch {
    return normalized;
  }
}

async function createChildAgentTools(
  input: AgentRunInput,
  config: RunnableConfig,
): Promise<{
  tools: StructuredToolInterface[];
  registerAll: (executor: ToolExecutor) => void;
  prompt: string;
}> {
  const tools: StructuredToolInterface[] = [];
  const executors = new Map<string, (args: ToolArgs) => Promise<unknown>>();

  for (const reference of input.agent.agents) {
    const child = await findAvailableAgent(reference);
    if (!child || child.agentName.toLowerCase() === input.agent.agentName.toLowerCase()) {
      continue;
    }

    const toolName = `agent_${child.agentName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')}`;
    const description = `Run the ${child.agentName} specialist agent for a delegated request. ${child.description}`;
    const run = async (args: ToolArgs) =>
      runAgent({
        agent: child,
        userMessage:
          typeof args.request === 'string' && args.request.trim()
            ? args.request
            : input.userMessage,
        projectPath: input.projectPath,
        config,
      });

    executors.set(toolName, run);
    tools.push(
      tool(
        async ({ request }) => run({ request }),
        {
          name: toolName,
          description,
          schema: z.object({
            request: z.string().min(1).describe('The work for the child agent.'),
          }),
        },
      ),
    );
  }

  return {
    tools,
    registerAll: (executor) => {
      for (const [name, execute] of executors) {
        const entry = tools.find((item) => item.name === name);
        executor.registerTool({
          name,
          description:
            (entry?.description as string | undefined) ??
            'Delegates work to a configured child agent.',
          execute,
        });
      }
    },
    prompt:
      tools.length > 0
        ? `CONFIGURED CHILD AGENTS\n${tools
            .map((childTool) => `- ${childTool.name}: ${childTool.description}`)
            .join('\n')}`
        : '',
  };
}
