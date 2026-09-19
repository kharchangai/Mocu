import { describe, expect, it } from 'vitest';

import {
  computeStdioFingerprint,
  importMcpServersDocument,
  isLocalUrl,
  normalizeMcpServerId,
  normalizeMcpServerEntry,
  validateMcpServerConfig,
} from './config';

describe('normalizeMcpServerId', () => {
  it('sanitizes ids into stable lowercase identifiers', () => {
    expect(normalizeMcpServerId('Chrome DevTools MCP')).toBe('chrome-devtools-mcp');
    expect(normalizeMcpServerId('  remote.tools! ')).toBe('remote-tools');
    expect(normalizeMcpServerId('///')).toBe('mcp-server');
  });
});

describe('importMcpServersDocument', () => {
  it('imports the common mcpServers format for local command servers', () => {
    const result = importMcpServersDocument(
      JSON.stringify({
        mcpServers: {
          'chrome-devtools': {
            command: 'npx',
            args: ['-y', 'chrome-devtools-mcp@latest', '--slim', '--headless'],
          },
        },
      }),
    );

    expect(result.servers).toHaveLength(1);
    const config = result.servers[0];
    expect(config.id).toBe('chrome-devtools');
    expect(config.name).toBe('chrome-devtools');
    expect(config.transport).toBe('stdio');
    expect(config.enabled).toBe(true);
    expect(config.command).toBe('npx');
    expect(config.args).toEqual(['-y', 'chrome-devtools-mcp@latest', '--slim', '--headless']);
    // User-provided arguments are preserved verbatim, no extra flags added.
  });

  it('imports remote servers with explicit transports and keeps secrets out of config', () => {
    const result = importMcpServersDocument(
      JSON.stringify({
        mcpServers: {
          'remote-tools': {
            transport: 'streamable-http',
            url: 'https://example.com/mcp',
          },
          'legacy-tools': {
            transport: 'sse',
            url: 'https://example.com/sse',
            headers: { Authorization: 'Bearer sk-token' },
          },
        },
      }),
    );

    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].transport).toBe('streamable-http');
    expect(result.servers[1].transport).toBe('sse');
    expect(result.secrets['legacy-tools']?.headers?.Authorization).toBe('Bearer sk-token');

    // The secret header must not leak into the stored configuration.
    expect(JSON.stringify(result.servers)).not.toContain('sk-token');
  });

  it('rejects command-based stdio with a remote URL', () => {
    expect(() =>
      normalizeMcpServerEntry('broken', {
        command: 'node',
        url: 'https://example.com/mcp',
      }),
    ).toThrow(/both 'command' and 'url'/);
  });

  it('rejects stdio transport with url', () => {
    expect(() =>
      normalizeMcpServerEntry('broken', {
        transport: 'stdio',
        command: 'node',
        url: 'https://example.com',
      }),
    ).toThrow(/must not declare a remote 'url'/);
  });

  it('rejects remote transport with command', () => {
    expect(() =>
      normalizeMcpServerEntry('broken', {
        transport: 'sse',
        command: 'node',
        url: 'https://example.com/sse',
      }),
    ).toThrow(/must not declare a local 'command'/);
  });

  it('rejects unknown transports with a clear message', () => {
    expect(() =>
      normalizeMcpServerEntry('broken', {
        transport: 'websocket',
        url: 'wss://example.com',
      }),
    ).toThrow(/unsupported transport 'websocket'/);
  });

  it('requires https for non-local endpoints unless explicitly overridden', () => {
    expect(() =>
      normalizeMcpServerEntry('insecure', {
        url: 'http://example.com/mcp',
      }),
    ).toThrow(/allowInsecureHttp/);

    const explicit = normalizeMcpServerEntry('insecure', {
      url: 'http://example.com/mcp',
      allowInsecureHttp: true,
    });
    expect(explicit.allowInsecureHttp).toBe(true);

    // Local http endpoints are allowed without an override.
    expect(normalizeMcpServerEntry('local', { url: 'http://localhost:3000/mcp' }).url).toBe(
      'http://localhost:3000/mcp',
    );
  });

  it('rejects non-http URL schemes', () => {
    expect(() =>
      normalizeMcpServerEntry('ws', { transport: 'streamable-http', url: 'ws://example.com' }),
    ).toThrow(/must use http or https/);
  });

  it('reports unsupported fields instead of silently dropping them', () => {
    const documented = normalizeMcpServerEntry('noted', {
      command: 'node',
      somethingElse: true,
    });
    expect(documented.notes?.join(' ')).toMatch(/somethingElse/);
  });

  it('renames duplicate ids deterministically', () => {
    // JSON.parse deduplicates identical keys, so the same-id case is covered
    // by the import-level deduplication for different-raw-id entries:
    const result = importMcpServersDocument(
      JSON.stringify({
        mcpServers: {
          'my tools': { url: 'https://a.example.com/mcp' },
          'my  tools': { url: 'https://b.example.com/mcp' },
        },
      }),
    );

    // Both normalize to the same sanitized id; the second is renamed.
    const ids = result.servers.map((server) => server.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('my-tools');
  });

  it('rejects invalid JSON', () => {
    expect(() => importMcpServersDocument('{ not json')).toThrow(/not valid JSON/);
  });
});

describe('fingerprint', () => {
  it('covers command, args, cwd, and env', () => {
    const base = computeStdioFingerprint({
      command: 'npx',
      args: ['-y', 'pkg'],
      cwd: '/work',
      env: { A: '1' },
    });

    expect(computeStdioFingerprint({
      command: 'npx',
      args: ['-y', 'pkg'],
      cwd: '/work',
      env: { A: '1' },
    })).toBe(base);

    expect(computeStdioFingerprint({
      command: 'npx',
      args: ['-y', 'pkg'],
      cwd: '/work',
      env: { A: '2' },
    })).not.toBe(base);

    expect(computeStdioFingerprint({
      command: 'npx',
      args: ['pkg', '-y'],
      cwd: '/work',
      env: { A: '1' },
    })).not.toBe(base);
  });
});

describe('validateMcpServerConfig', () => {
  it('round-trips a valid config', () => {
    const validated = validateMcpServerConfig({
      id: 'remote',
      name: 'Remote',
      transport: 'streamable-http',
      enabled: true,
      authType: 'bearer',
      url: 'https://example.com/mcp',
    });

    expect(validated.id).toBe('remote');
    expect(validated.authType).toBe('bearer');
  });

  it('rejects configs that fail validation', () => {
    expect(() =>
      validateMcpServerConfig({
        id: 'remote',
        name: 'Remote',
        transport: 'streamable-http',
        enabled: true,
        authType: 'none',
      }),
    ).toThrow(/no 'url'/);
  });
});

describe('isLocalUrl', () => {
  it('detects local endpoints', () => {
    expect(isLocalUrl('http://localhost:3000/mcp')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isLocalUrl('https://example.com')).toBe(false);
  });
});
