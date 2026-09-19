import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  configureMcpRuntime,
  connectMcpServer,
  callMcpTool,
  saveMcpServer,
  shutdownMcpManager,
  disconnectMcpServer,
} from './manager';
import {
  configureMcpStorage,
  type McpStorageBackend,
} from './storage';
import { createNodeStdioSpawnHost } from './runtime-node';

const fixturePath = fileURLToPath(
  new URL('./testing/fixture-http-server.mjs', import.meta.url),
);

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

type FixtureProcess = {
  child: ReturnType<typeof spawn>;
  url: string;
};

async function startFixture(
  mode: 'streamable' | 'sse',
  expectedAuth = '',
): Promise<FixtureProcess> {
  const child = spawn(process.execPath, [
    fixturePath,
    mode,
    expectedAuth,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    process.stderr.write(`[fixture ${mode}] ${chunk}`);
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`fixture ${mode} did not start`)),
      15_000,
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const match = chunk.match(/ready (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`fixture ${mode} exited with ${code}`));
    });
  });

  return { child, url };
}

describe('MCP manager (HTTP transports, local fixture servers)', () => {
  beforeAll(() => {
    configureMcpStorage(createMemoryStorage());
    // fetchImpl is intentionally omitted: the manager falls back to the
    // global fetch, which works in Node tests and mirrors the app default.
    configureMcpRuntime({ spawnHost: createNodeStdioSpawnHost() });
  });

  afterAll(async () => {
    await shutdownMcpManager();
  });

  it('connects through Streamable HTTP and calls tools without a child process', async () => {
    const fixture = await startFixture('streamable');

    try {
      await saveMcpServer({
        id: 'remote-fixture',
        name: 'Remote Fixture',
        transport: 'streamable-http',
        enabled: true,
        authType: 'none',
        url: fixture.url,
      });

      const summary = await connectMcpServer('remote-fixture');
      expect(summary?.status).toBe('connected');
      expect(summary?.capabilities.tools).toBe(true);

      const result = await callMcpTool('remote-fixture', 'echo', {
        text: 'over-http',
      });
      expect(result.isError).toBe(false);
      expect(result.text).toContain('echo: over-http');
      expect(result.text).toContain('auth: none');
    } finally {
      fixture.child.kill();
    }
  });

  it('sends configured bearer tokens on remote requests', async () => {
    const token = 'test-token-12345';
    const fixture = await startFixture('sse', `Bearer ${token}`);

    try {
      await saveMcpServer(
        {
          id: 'auth-fixture',
          name: 'Auth Fixture',
          transport: 'sse',
          enabled: true,
          authType: 'bearer',
          url: `${fixture.url}sse`,
        },
        { bearerToken: token },
      );

      const summary = await connectMcpServer('auth-fixture');
      expect(summary?.status).toBe('connected');

      const result = await callMcpTool('auth-fixture', 'echo', { text: 'x' });
      expect(result.text).toContain('auth: seen');

      // The stored config must not contain the secret token.
      const servers = await (
        await import('./manager')
      ).listMcpServers();
      expect(
        JSON.stringify(servers.map((server) => server.config)),
      ).not.toContain(token);
    } finally {
      fixture.child.kill();
      await disconnectMcpServer('auth-fixture');
    }
  });

  it('rejects plain http to non-local endpoints without an explicit override', async () => {
    await expect(
      saveMcpServer({
        id: 'insecure',
        name: 'Insecure',
        transport: 'streamable-http',
        enabled: true,
        authType: 'none',
        url: 'http://example.com/mcp',
      }),
    ).rejects.toThrow(/allowInsecureHttp/);
  });
});
