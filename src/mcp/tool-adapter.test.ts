import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  configureMcpStorage,
  type McpStorageBackend,
} from './storage';
import {
  configureMcpRuntime,
  importMcpServers,
  shutdownMcpManager,
} from './manager';
import { createNodeStdioSpawnHost } from './runtime-node';
import {
  MCP_CALL_TOOL_NAME,
  MCP_LIST_TOOLS_NAME,
  buildMocuToolName,
  formatMcpToolReference,
  loadMcpAgentTools,
  parseMcpToolReference,
  type McpToolSelection,
} from './tool-adapter';

const fixturePath = fileURLToPath(
  new URL('./testing/fixture-server.mjs', import.meta.url),
);

/** In-memory storage backend so the manager runs fully in Node. */
function createMemoryStorage(): McpStorageBackend {
  const configs = new Map<string, unknown>();
  const secrets = new Map<string, unknown>();

  return {
    async listConfigs() {
      return [...configs.values()] as never[];
    },
    async getConfig(serverId) {
      return (configs.get(serverId) as never) ?? null;
    },
    async saveConfig(config) {
      configs.set(config.id, JSON.parse(JSON.stringify(config)));
    },
    async deleteConfig(serverId) {
      configs.delete(serverId);
    },
    async getSecrets(serverId) {
      return (secrets.get(serverId) as never) ?? {};
    },
    async saveSecrets(serverId, value) {
      secrets.set(serverId, JSON.parse(JSON.stringify(value)));
    },
    async deleteSecrets(serverId) {
      secrets.delete(serverId);
    },
  };
}

describe('parseMcpToolReference', () => {
  it('parses per-tool and whole-server references', () => {
    expect(parseMcpToolReference('mcp:chrome-devtools/navigate')).toEqual({
      serverId: 'chrome-devtools',
      toolName: 'navigate',
    });

    expect(parseMcpToolReference('mcp:chrome-devtools/*')).toEqual({
      serverId: 'chrome-devtools',
    });

    expect(parseMcpToolReference('mcp:chrome-devtools')).toEqual({
      serverId: 'chrome-devtools',
    });

    // Tool names may contain slashes; the first slash separates server/tool.
    expect(parseMcpToolReference('mcp:srv/some/tool')).toEqual({
      serverId: 'srv',
      toolName: 'some/tool',
    });

    expect(parseMcpToolReference('terminal_executor')).toBeNull();
    expect(parseMcpToolReference('mcp:')).toBeNull();
  });

  it('round-trips through format', () => {
    const perTool: McpToolSelection = { serverId: 'srv', toolName: 'tool' };
    const wholeServer: McpToolSelection = { serverId: 'srv' };

    expect(formatMcpToolReference(perTool)).toBe('mcp:srv/tool');
    expect(formatMcpToolReference(wholeServer)).toBe('mcp:srv/*');
  });
});

describe('buildMocuToolName', () => {
  it('sanitizes server and tool names', () => {
    const used = new Set<string>();
    expect(buildMocuToolName('Chrome DevTools', 'navigate.page', used)).toBe(
      'mcp_chrome_devtools_navigate_page',
    );
  });

  it('resolves duplicate tool names with a deterministic suffix', () => {
    const used = new Set<string>();
    const first = buildMocuToolName('srv', 'echo', used);
    const second = buildMocuToolName('srv', 'echo', used);

    expect(first).toBe('mcp_srv_echo');
    expect(second).toBe('mcp_srv_echo_2');
  });

  it('stays within model-provider name limits', () => {
    const used = new Set<string>();
    const name = buildMocuToolName(
      'a-very-long-server-name-that-keeps-going',
      'an-extremely-long-mcp-tool-name-that-also-keeps-going',
      used,
    );

    expect(name.length).toBeLessThanOrEqual(64);
    expect(/^[a-zA-Z0-9_-]+$/.test(name)).toBe(true);
  });
});

describe('loadMcpAgentTools', () => {
  it('returns an empty set for an empty selection without touching the manager', async () => {
    const toolSet = await loadMcpAgentTools([]);
    expect(toolSet.tools).toHaveLength(0);
    expect(toolSet.prompt).toBe('');
  });

  it('marks selections for disabled or unknown servers as unresolved', async () => {
    const configs = new Map<string, unknown>();
    configureMcpStorage({
      async listConfigs() {
        return [...configs.values()] as never[];
      },
      async getConfig() {
        return null;
      },
      async saveConfig(config) {
        configs.set(config.id, config);
      },
      async deleteConfig(serverId) {
        configs.delete(serverId);
      },
      async getSecrets() {
        return {};
      },
      async saveSecrets() {},
      async deleteSecrets() {},
    } satisfies McpStorageBackend);

    const toolSet = await loadMcpAgentTools([
      { serverId: 'definitely-not-configured' },
    ]);

    expect(toolSet.tools).toHaveLength(0);
    expect(toolSet.unresolved).toEqual(['mcp:definitely-not-configured/*']);
  });

  it('exposes the two gateway tools instead of binding every server tool', async () => {
    configureMcpStorage(createMemoryStorage());
    configureMcpRuntime({ spawnHost: createNodeStdioSpawnHost() });

    await importMcpServers(
      JSON.stringify({
        mcpServers: {
          fixture: {
            name: 'Fixture Server',
            command: process.execPath,
            args: [fixturePath],
          },
        },
      }),
    );

    // Approve the first connection so the lazy connect inside the adapter
    // succeeds (approval-required stdio servers stay unresolved instead).
    const { connectMcpServer } = await import('./manager');
    await connectMcpServer('fixture', { approve: true });

    const toolSet = await loadMcpAgentTools([{ serverId: 'fixture' }]);

    expect(toolSet.unresolved).toEqual([]);
    expect(toolSet.tools.map((gateway) => gateway.name)).toEqual([
      MCP_LIST_TOOLS_NAME,
      MCP_CALL_TOOL_NAME,
    ]);

    // The prompt carries only the server name + description, not every tool.
    expect(toolSet.prompt).toContain('Fixture Server');
    expect(toolSet.prompt).not.toContain('- echo:');

    // Gateway 1: list the server's tools.
    const listTool = toolSet.tools.find(
      (gateway) => gateway.name === MCP_LIST_TOOLS_NAME,
    );
    expect(listTool).toBeDefined();
    const listed = await listTool!.invoke({ server: 'Fixture Server' });
    expect(listed).toContain('"echo"');

    // Gateway 2: call one of the listed tools.
    const callTool = toolSet.tools.find(
      (gateway) => gateway.name === MCP_CALL_TOOL_NAME,
    );
    expect(callTool).toBeDefined();
    const callResult = await callTool!.invoke({
      server: 'fixture',
      tool: 'echo',
      arguments: { text: 'hello gateway' },
    });
    expect(callResult).toContain('echo: hello gateway');

    // Servers that were not selected are rejected by the gateway tools.
    await expect(
      callTool!.invoke({
        server: 'other-server',
        tool: 'echo',
        arguments: { text: 'x' },
      }),
    ).rejects.toThrow(/was not selected for this request/);
  });
});
