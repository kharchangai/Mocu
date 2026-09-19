/**
 * Adapts selected MCP servers into Mocu's agent tool registry.
 *
 * Selected MCP servers are NOT expanded into one callable tool per MCP tool.
 * Instead the model receives, per request:
 *
 *   - the MCP server name + description in the system prompt, and
 *   - two gateway tools:
 *       mcp_list_tools  -> takes the MCP server name, returns every tool the
 *                          server exposes (name, description, arguments).
 *       mcp_call_tool   -> takes the server name, a tool name, and a JSON
 *                          arguments object, and executes that tool.
 *
 * The intended model flow is: list the MCP tools first, then call the tool
 * that fits the job. Only servers the user explicitly selected for the
 * current request are accepted by the gateway tools; the manager validates
 * the server/tool pair again at execution time.
 */

import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

import type { ToolExecutor } from '../services/ai/agent/tool-executor';
import {
  callMcpTool,
  connectMcpServer,
  getMcpServerTools,
  listMcpServers,
} from './manager';

/** One MCP tool reference (kept for stored `mcp:<server>/<tool>` strings). */
export type McpToolSelection = {
  serverId: string;
  /** undefined = every tool of the server. */
  toolName?: string;
};

/**
 * Parses agent tool entries like `mcp:server-id/tool-name` or
 * `mcp:server-id/*` (whole server).
 */
export function parseMcpToolReference(
  reference: string,
): McpToolSelection | null {
  if (!reference.startsWith('mcp:')) {
    return null;
  }

  const rest = reference.slice('mcp:'.length);
  const slashIndex = rest.indexOf('/');

  if (slashIndex < 0) {
    const serverId = rest.trim();
    return serverId ? { serverId } : null;
  }

  const serverId = rest.slice(0, slashIndex).trim();
  const toolName = rest.slice(slashIndex + 1).trim();

  if (!serverId) {
    return null;
  }

  if (!toolName || toolName === '*') {
    return { serverId };
  }

  return { serverId, toolName };
}

/** Renders a selection back into its stored reference form. */
export function formatMcpToolReference(selection: McpToolSelection): string {
  return selection.toolName
    ? `mcp:${selection.serverId}/${selection.toolName}`
    : `mcp:${selection.serverId}/*`;
}

/** The model-facing names of the two MCP gateway tools. */
export const MCP_LIST_TOOLS_NAME = 'mcp_list_tools';
export const MCP_CALL_TOOL_NAME = 'mcp_call_tool';

export type McpServerEntry = {
  /** Display name of the MCP server. */
  name: string;
  serverId: string;
  /** Human-readable description of what the server provides. */
  description: string;
};

export type McpAgentToolSet = {
  tools: StructuredToolInterface[];
  entries: McpServerEntry[];
  registerAll: (executor: ToolExecutor) => void;
  prompt: string;
  /** Selections that referenced unknown or unreachable servers. */
  unresolved: string[];
};

function sanitizeToolNamePart(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'mcp'
  );
}

/**
 * Builds a collision-safe Mocu tool identifier for an MCP tool. Kept for
 * stored `mcp:<server>/<tool>` reference rendering and tests.
 */
export function buildMocuToolName(
  serverId: string,
  mcpToolName: string,
  usedNames: Set<string>,
): string {
  const base = `mcp_${sanitizeToolNamePart(serverId)}_${sanitizeToolNamePart(
    mcpToolName,
  )}`
    .slice(0, 64)
    .replace(/_+$/, '');

  let name = base;
  let suffix = 2;

  while (usedNames.has(name)) {
    const suffixText = `_${suffix}`;
    name = `${base.slice(0, 64 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  usedNames.add(name);
  return name;
}

function describeMcpServer(config: {
  transport: string;
  command?: string;
  url?: string;
}): string {
  return config.transport === 'stdio'
    ? `Local MCP server: ${config.command ?? ''}`.trim()
    : `Remote MCP server: ${config.url ?? ''}`.trim();
}

/**
 * Loads the gateway tools for the MCP servers selected for one request.
 *
 * Only enabled servers contribute, and every server is connected lazily
 * (stdio servers that still need execution approval are reported as
 * unresolved instead of silently executing anything). Failures degrade to an
 * empty tool set with `unresolved` reported; they never block the agent.
 */
export async function loadMcpAgentTools(
  selection: McpToolSelection[],
): Promise<McpAgentToolSet> {
  if (selection.length === 0) {
    return {
      tools: [],
      entries: [],
      registerAll: () => undefined,
      prompt: '',
      unresolved: [],
    };
  }

  let summaries: Awaited<ReturnType<typeof listMcpServers>>;
  try {
    summaries = await listMcpServers();
  } catch {
    return {
      tools: [],
      entries: [],
      registerAll: () => undefined,
      prompt: '',
      unresolved: [],
    };
  }

  const enabledServers = new Map(
    summaries
      .filter((summary) => summary.config.enabled)
      .map((summary) => [
        summary.config.id,
        {
          serverId: summary.config.id,
          name: summary.config.name,
          description: describeMcpServer(summary.config),
        },
      ]),
  );

  const entries: McpServerEntry[] = [];
  const unresolved: string[] = [];
  const seenSelections = new Set<string>();

  for (const item of selection) {
    const serverId = item.serverId.trim();
    if (!serverId) {
      continue;
    }

    const selectionKey = formatMcpToolReference(item);
    if (seenSelections.has(selectionKey)) {
      continue;
    }
    seenSelections.add(selectionKey);

    const entry = enabledServers.get(serverId);
    if (!entry) {
      unresolved.push(selectionKey);
      continue;
    }

    // Connect lazily so mcp_list_tools/mcp_call_tool can talk to the server.
    // Approval-required stdio servers surface as unresolved; the user
    // approves execution from the MCP page first.
    try {
      let discovered = await getMcpServerTools(serverId);
      if (discovered.length === 0) {
        const summary = await connectMcpServer(serverId);
        if (summary?.status === 'connected') {
          discovered = await getMcpServerTools(serverId);
        }
      }

      if (discovered.length === 0) {
        unresolved.push(selectionKey);
        continue;
      }
    } catch {
      unresolved.push(selectionKey);
      continue;
    }

    if (!entries.some((existing) => existing.serverId === serverId)) {
      entries.push(entry);
    }
  }

  if (entries.length === 0) {
    return {
      tools: [],
      entries: [],
      registerAll: () => undefined,
      prompt: '',
      unresolved,
    };
  }

  type GatewayArgs = Record<string, unknown>;

  const resolveSelectedServer = (
    serverArg: unknown,
  ): McpServerEntry | null => {
    const requested =
      typeof serverArg === 'string' ? serverArg.trim().toLowerCase() : '';

    if (!requested) {
      return null;
    }

    return (
      entries.find(
        (entry) =>
          entry.serverId.toLowerCase() === requested ||
          entry.name.toLowerCase() === requested,
      ) ?? null
    );
  };

  const executeListTools = async (
    args: GatewayArgs,
  ): Promise<string> => {
    const entry = resolveSelectedServer(args.server);

    if (!entry) {
      throw new Error(
        `MCP server '${String(args.server)}' was not selected for this request. ` +
          `Selected MCP servers: ${entries.map((item) => item.name).join(', ')}.`,
      );
    }

    const discovered = await getMcpServerTools(entry.serverId);

    if (discovered.length === 0) {
      throw new Error(
        `MCP server '${entry.name}' is connected but exposed no tools.`,
      );
    }

    return JSON.stringify(
      discovered.map((mcpTool) => ({
        name: mcpTool.name,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema,
      })),
      null,
      2,
    );
  };

  const executeCallTool = async (
    args: GatewayArgs,
  ): Promise<string> => {
    const entry = resolveSelectedServer(args.server);

    if (!entry) {
      throw new Error(
        `MCP server '${String(args.server)}' was not selected for this request. ` +
          `Selected MCP servers: ${entries.map((item) => item.name).join(', ')}.`,
      );
    }

    const mcpToolName =
      typeof args.tool === 'string' ? args.tool : '';

    const discovered = await getMcpServerTools(entry.serverId);

    if (!mcpToolName || !discovered.some((item) => item.name === mcpToolName)) {
      throw new Error(
        `MCP server '${entry.name}' does not expose a tool named '${String(args.tool)}'. ` +
          `Call ${MCP_LIST_TOOLS_NAME} first to see the available tools.`,
      );
    }

    const result = await callMcpTool(
      entry.serverId,
      mcpToolName,
      (args.arguments ?? {}) as Record<string, unknown>,
    );

    if (result.isError) {
      // MCP tool-reported errors surface as failed tool calls through the
      // normal pipeline instead of silent success.
      throw new Error(
        `The MCP tool '${mcpToolName}' reported an error: ${result.text}`,
      );
    }

    return result.text;
  };

  const listToolsTool = tool(
    async (invocationArgs) => executeListTools((invocationArgs ?? {}) as GatewayArgs),
    {
      name: MCP_LIST_TOOLS_NAME,
      description:
        'Lists every tool an MCP server exposes. Call this first for a ' +
        'selected MCP server, then call mcp_call_tool with one of the ' +
        'returned tool names. Pass the MCP server display name (or id).',
      schema: z.object({
        server: z
          .string()
          .min(1)
          .describe('The MCP server name (as shown in the selected servers list).'),
      }),
    },
  );

  const callToolTool = tool(
    async (invocationArgs) => executeCallTool((invocationArgs ?? {}) as GatewayArgs),
    {
      name: MCP_CALL_TOOL_NAME,
      description:
        'Executes one tool on a selected MCP server. Call ' +
        `${MCP_LIST_TOOLS_NAME} first to discover tool names and their ` +
        'argument schemas.',
      schema: z.object({
        server: z
          .string()
          .min(1)
          .describe('The MCP server name (as shown in the selected servers list).'),
        tool: z
          .string()
          .min(1)
          .describe('The exact MCP tool name returned by mcp_list_tools.'),
        arguments: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Arguments object matching the tool schema.'),
      }),
    },
  );

  const gatewayTools: StructuredToolInterface[] = [listToolsTool, callToolTool];

  const executors = new Map<string, (args: GatewayArgs) => Promise<string>>([
    [MCP_LIST_TOOLS_NAME, executeListTools],
    [MCP_CALL_TOOL_NAME, executeCallTool],
  ]);

  return {
    tools: gatewayTools,
    entries,
    registerAll: (executor: ToolExecutor) => {
      for (const [name, execute] of executors) {
        executor.registerTool({
          name,
          description:
            gatewayTools.find((gatewayTool) => gatewayTool.name === name)
              ?.description ?? 'MCP gateway tool.',
          execute,
        });
      }
    },
    prompt: buildMcpServersPrompt(entries),
    unresolved,
  };
}

function buildMcpServersPrompt(entries: McpServerEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  return [
    'MCP SERVERS SELECTED FOR THIS REQUEST',
    'The tools of these MCP servers are not loaded up front. To use one:',
    `1. Call ${MCP_LIST_TOOLS_NAME} with the server name to see every tool it exposes (names, descriptions, argument schemas).`,
    `2. Call ${MCP_CALL_TOOL_NAME} with the server name, a tool name, and a JSON arguments object to do the job.`,
    '',
    ...entries.map(
      (entry) => `- ${entry.name} (id: ${entry.serverId}): ${entry.description}`,
    ),
  ].join('\n');
}
