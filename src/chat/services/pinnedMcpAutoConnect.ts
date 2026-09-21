// src/chat/services/pinnedMcpAutoConnect.ts
//
// Auto-connects MCP servers that are pinned (toggled ON) in chats.
//
// MCP connections live in memory only, so every time the app starts all
// servers are disconnected and the user had to reconnect manually before
// the agent could use their tools. Because pinned servers are the ones
// the user explicitly wants active per conversation, they are connected
// automatically:
//   - when the user toggles a server ON in the chat composer, and
//   - once at app startup for every server pinned in any chat.
//
// Approval-gated stdio servers are never auto-approved: they surface the
// approval error and the user approves execution from the MCP page.

import {
  connectMcpServer,
  listMcpServers,
} from '../../mcp/manager';
import { McpApprovalRequiredError } from '../../mcp/types';
import {
  getAllChatResourceSelections,
} from './chatResourceToggles';

/**
 * Connects every enabled MCP server that is pinned to at least one
 * conversation, unless it is already connected or connecting.
 */
export async function connectPinnedMcpServers(): Promise<void> {
  const pinnedServerIds = new Set<string>();

  for (const selection of getAllChatResourceSelections().values()) {
    for (const server of selection.mcpServers) {
      const serverId = server.id.trim();

      if (serverId) {
        pinnedServerIds.add(serverId);
      }
    }
  }

  if (pinnedServerIds.size === 0) {
    return;
  }

  let summaries: Awaited<ReturnType<typeof listMcpServers>>;

  try {
    summaries = await listMcpServers();
  } catch (error) {
    console.warn(
      '[MCP Auto Connect] Could not list MCP servers:',
      error,
    );

    return;
  }

  const statusById = new Map(
    summaries.map((summary) => [summary.config.id, summary]),
  );

  for (const serverId of pinnedServerIds) {
    const summary = statusById.get(serverId);

    if (!summary || !summary.config.enabled) {
      continue;
    }

    if (
      summary.status === 'connected' ||
      summary.status === 'connecting'
    ) {
      continue;
    }

    try {
      const connected = await connectMcpServer(serverId);

      if (connected?.status === 'connected') {
        console.log(
          `[MCP Auto Connect] Connected pinned server "${summary.config.name}".`,
        );
      }
    } catch (error) {
      if (error instanceof McpApprovalRequiredError) {
        console.info(
          `[MCP Auto Connect] Server "${summary.config.name}" needs ` +
            'execution approval before it can connect. Approve it on the ' +
            'MCP page.',
        );
      } else {
        console.warn(
          `[MCP Auto Connect] Failed to connect pinned server ` +
            `"${summary.config.name}":`,
          error,
        );
      }
    }
  }
}

/**
 * Connects a single MCP server the user just toggled ON in the chat
 * composer. Fire-and-forget: failures are logged, the send path reports
 * unresolved servers if the tools end up unavailable.
 */
export function autoConnectMcpServer(
  serverId: string,
  serverName: string,
): void {
  void (async () => {
    try {
      const connected = await connectMcpServer(serverId);

      if (connected?.status === 'connected') {
        console.log(
          `[MCP Auto Connect] Connected "${serverName}" after it was ` +
            'toggled on in a chat.',
        );
      }
    } catch (error) {
      if (error instanceof McpApprovalRequiredError) {
        console.info(
          `[MCP Auto Connect] Server "${serverName}" needs execution ` +
            'approval before it can connect. Approve it on the MCP page.',
        );
      } else {
        console.warn(
          `[MCP Auto Connect] Failed to connect "${serverName}":`,
          error,
        );
      }
    }
  })();
}
