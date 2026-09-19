/**
 * MCP transport and client creation using the official TypeScript SDK.
 *
 * No JSON-RPC is implemented here: the SDK's Client handles initialization,
 * capability negotiation, requests, and notifications. This module only
 * picks the right transport:
 *
 * - stdio: a Transport adapter over Mocu's runtime process host (Rust
 *   backend in the app, node:child_process in tests).
 * - streamable-http: SDK StreamableHTTPClientTransport.
 * - sse: SDK SSEClientTransport (legacy compatibility, explicit selection).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type {
  McpRuntime,
  McpServerConfig,
  McpServerSecrets,
} from './types';
import { McpTransportError } from './types';

const MOCU_CLIENT_INFO = { name: 'Mocu', version: '0.1.0' } as const;

/**
 * Builds the HTTP headers for a remote connection from the server's auth
 * settings and secrets.
 */
export function buildRemoteHeaders(
  config: McpServerConfig,
  secrets: McpServerSecrets,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.authType === 'bearer' && secrets.bearerToken) {
    headers['Authorization'] = `Bearer ${secrets.bearerToken}`;
  }

  if (secrets.headers) {
    for (const [key, value] of Object.entries(secrets.headers)) {
      if (key.trim()) {
        headers[key] = value;
      }
    }
  }

  return headers;
}

/** Transport adapter over Mocu's runtime spawn host (Rust in the app). */
class RuntimeStdioClientTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: unknown) => void;

  private handle: Awaited<
    ReturnType<McpRuntime['spawnHost']['start']>
  > | null = null;

  constructor(
    private readonly connectionId: string,
    private readonly runtime: McpRuntime,
    private readonly spec: {
      command: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
    },
  ) {}

  async start(): Promise<void> {
    const handle = await this.runtime.spawnHost.start(
      this.connectionId,
      this.spec,
      {
        onMessage: (line) => {
          try {
            const message = JSON.parse(line);
            this.onmessage?.(message);
          } catch (error) {
            this.onerror?.(
              new Error(`Invalid JSON from MCP server: ${error instanceof Error ? error.message : String(error)}`),
            );
          }
        },
        onStderr: () => {
          // Diagnostics are buffered by the host and surfaced through the
          // manager; the transport itself treats stderr as non-fatal.
        },
        onExit: () => {
          this.handle = null;
          this.onclose?.();
        },
      },
    );

    this.handle = handle;
  }

  async send(message: unknown): Promise<void> {
    if (!this.handle) {
      throw new McpTransportError(
        'The MCP server process is not running.',
      );
    }

    await this.handle.send(JSON.stringify(message)).catch((error: unknown) => {
      throw new McpTransportError(
        `Failed to write to the MCP server process: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;

    // Closing the client must stop the local child process so no orphans
    // survive. (Remote transports must NOT do this; closing an HTTP session
    // never shuts down a remote server.)
    if (handle) {
      await handle.stop().catch(() => undefined);
      this.onclose?.();
    }
  }
}

export type McpClientBundle = {
  client: Client;
  closeTransport: () => Promise<void>;
};

/**
 * Creates the SDK client and connects it through the configured transport.
 * Initialization (initialize handshake + capability negotiation) happens
 * inside client.connect().
 */
export async function connectMcpClient(
  config: McpServerConfig,
  secrets: McpServerSecrets,
  runtime: McpRuntime,
  connectTimeoutSeconds: number,
): Promise<McpClientBundle> {
  const client = new Client(MOCU_CLIENT_INFO, {
    capabilities: {
      // Mocu deliberately advertises no client capabilities it does not
      // implement: no roots, no sampling, no elicitation. Servers requesting
      // them receive a clear method-not-found error instead of fake success.
    },
  });

  let transport: Transport;
  let closeTransport: () => Promise<void>;

  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new McpTransportError(
        `Server '${config.id}' has no configured command.`,
      );
    }

    transport = new RuntimeStdioClientTransport(config.id, runtime, {
      command: config.command,
      args: config.args ?? [],
      cwd: config.cwd,
      env: secrets.env ?? {},
    });
    closeTransport = () => transport.close();
  } else {
    if (!config.url) {
      throw new McpTransportError(
        `Server '${config.id}' has no configured URL.`,
      );
    }

    const headers = buildRemoteHeaders(config, secrets);
    const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
    let url: URL;

    try {
      url = new URL(config.url);
    } catch {
      throw new McpTransportError(
        `Server '${config.id}' has an invalid URL: ${config.url}`,
      );
    }

    if (config.transport === 'streamable-http') {
      const streamable = new StreamableHTTPClientTransport(url, {
        fetch: fetchImpl,
        ...(Object.keys(headers).length > 0 ? { requestInit: { headers } } : {}),
      });
      transport = streamable;
      // Closing an HTTP session must never attempt to shut down the remote
      // server; the SDK transport only tears down the client-side session.
      closeTransport = () => streamable.close();
    } else {
      // Legacy SSE: the initial GET (event source) and the POSTs are two
      // separate request channels, so auth headers must be attached to both.
      // (The DOM EventSourceInit type only declares withCredentials; the SDK
      // merges eventSourceInit.headers into the SSE request at runtime.)
      const sse = new SSEClientTransport(url, {
        fetch: fetchImpl,
        ...(Object.keys(headers).length > 0
          ? {
              requestInit: { headers },
              eventSourceInit: { headers } as unknown as EventSourceInit,
            }
          : {}),
      });
      transport = sse;
      closeTransport = () => sse.close();
    }
  }

  try {
    await client.connect(transport, {
      timeout: connectTimeoutSeconds * 1000,
    });
  } catch (error) {
    await closeTransport().catch(() => undefined);
    throw normalizeConnectError(config, error);
  }

  return { client, closeTransport };
}

function normalizeConnectError(
  config: McpServerConfig,
  error: unknown,
): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (config.transport === 'stdio') {
    return new McpTransportError(
      `Failed to connect to MCP server '${config.id}': ${message}. ` +
        (config.command === 'npx' || config.command === 'npm'
          ? 'Node.js/npm must be installed, and the first start may need to download the package.'
          : ''),
    );
  }

  return new McpTransportError(
    `Failed to connect to MCP server '${config.id}' (${config.transport}): ${message}`,
  );
}
