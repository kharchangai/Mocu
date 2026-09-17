import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import { z } from 'zod';

import type { ToolExecutor } from '../../services/ai/agent/tool-executor';
import { findAvailableAgent, type AvailableAgent } from './agent-loader';
import { runAgent } from './agent-runner';

const MAX_TOOL_NAME_LENGTH = 64;

type AgentToolEntry = {
  name: string;
  agentName: string;
  description: string;
};

export type AgentToolSet = {
  tools: StructuredToolInterface[];
  entries: AgentToolEntry[];
  registerAll: (executor: ToolExecutor) => void;
  prompt: string;
  missingAgents: string[];
};

/**
 * Creates callable LangChain tools for the agents selected in ChatInput.
 * Agents are not started while loading this set. They run only after the
 * main agent emits the corresponding tool call.
 */
export async function loadAgentTools(
  selectedAgentNames: string[] = [],
  projectPath = '',
  config: RunnableConfig = {},
): Promise<AgentToolSet> {
  const requestedNames = uniqueStrings(selectedAgentNames);

  if (requestedNames.length === 0) {
    return emptyAgentToolSet();
  }

  const tools: StructuredToolInterface[] = [];
  const entries: AgentToolEntry[] = [];
  const executors = new Map<
    string,
    (args: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown>
  >();
  const usedNames = new Set<string>();
  const missingAgents: string[] = [];

  for (const requestedName of requestedNames) {
    const agent = await findAvailableAgent(requestedName);

    if (!agent) {
      missingAgents.push(requestedName);
      continue;
    }

    const toolName = buildAgentToolName(agent, usedNames);
    const description = `Run the ${agent.agentName} specialist agent for the user's request. ${agent.description}`;
    const execute = async (
      args: Record<string, unknown>,
      _context?: Record<string, unknown>,
    ): Promise<unknown> => {
      const request = typeof args.request === 'string' ? args.request.trim() : '';
      if (!request) {
        throw new Error(`The ${agent.agentName} agent requires a non-empty request.`);
      }

      return runAgent({
        agent,
        userMessage: request,
        projectPath,
        config,
      });
    };

    executors.set(toolName, execute);
    entries.push({
      name: toolName,
      agentName: agent.agentName,
      description,
    });

    tools.push(
      tool(
        async ({ request }) => execute({ request }),
        {
          name: toolName,
          description,
          schema: z.object({
            request: z.string().min(1).describe('The complete work request for the specialist agent.'),
          }),
        },
      ),
    );
  }

  return {
    tools,
    entries,
    missingAgents,
    registerAll: (executor) => {
      for (const [name, execute] of executors) {
        const entry = entries.find((item) => item.name === name);
        executor.registerTool({
          name,
          description: entry?.description ?? 'Runs a configured specialist agent.',
          execute,
        });
      }
    },
    prompt: buildAgentToolsPrompt(entries),
  };
}

function emptyAgentToolSet(): AgentToolSet {
  return {
    tools: [],
    entries: [],
    registerAll: () => undefined,
    prompt: '',
    missingAgents: [],
  };
}

function buildAgentToolsPrompt(entries: AgentToolEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  return [
    'SELECTED SPECIALIST AGENT TOOLS',
    'The user explicitly selected these specialist agents. You must call each selected agent tool before answering the request.',
    'The specialist receives the request you put in the request argument, runs to completion, and returns its result to you.',
    'Do not claim the specialist completed work unless its tool result confirms it.',
    ...entries.map((entry) => `- ${entry.name}: ${entry.description}`),
  ].join('\n');
}

function buildAgentToolName(
  agent: AvailableAgent,
  usedNames: Set<string>,
): string {
  const base = `agent_${agent.agentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'specialist'}`
    .slice(0, MAX_TOOL_NAME_LENGTH)
    .replace(/_+$/, '');

  let name = base;
  let suffix = 2;

  while (usedNames.has(name)) {
    const suffixText = `_${suffix}`;
    name = `${base.slice(0, MAX_TOOL_NAME_LENGTH - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  usedNames.add(name);
  return name;
}

function uniqueStrings(values: string[]): string[] {
  const unique = new Map<string, string>();

  for (const value of values) {
    const normalized = value.trim();
    if (normalized && !unique.has(normalized.toLowerCase())) {
      unique.set(normalized.toLowerCase(), normalized);
    }
  }

  return [...unique.values()];
}
