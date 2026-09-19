import type {
  AvailableMcpServer,
  SelectedMcpServer,
} from './mcpTypes';

/*
 * Filters MCP servers by name or id against the query text after "/mcp ".
 */
export function filterMcpServers(
  servers: AvailableMcpServer[],
  query: string,
): AvailableMcpServer[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return servers;
  }

  return servers.filter((server) => {
    const nameMatch = server.name.toLowerCase().includes(normalizedQuery);
    const idMatch = server.id.toLowerCase().includes(normalizedQuery);
    return nameMatch || idMatch;
  });
}

export type { SelectedMcpServer };
