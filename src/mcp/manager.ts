/**
 * Central MCP manager for Mocu.
 *
 * Owns server configurations, active connections, connection status,
 * authentication state, tool-discovery caches, tool calls, cancellation,
 * and cleanup. One server process / HTTP session is shared by every tool
 * call on that connection — never one process per call.
 *
 * Errors are classified:
 * - MCP protocol errors (the server rejected a request) surface verbatim.
 * - Connection/transport errors are wrapped in McpTransportError.
 * - Tool results marked isError are returned as normal results with
 *   isError=true; they are never confused with transport failures.
 *
 * A failed call is never blindly replayed after a reconnect: the caller
 * decides whether to retry, because the call may already have performed an
 * external action.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ToolListChangedNotificationSchema,
  type ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';

import {
  computeStdioFingerprint,
  validateMcpServerConfig,
} from './config';
import { connectMcpClient, type McpClientBundle } from './connection';
import { normalizeToolCallResult } from './results';
import {
  deleteStoredMcpConfig,
  deleteStoredMcpSecrets,
  getStoredMcpConfig,
  getStoredMcpSecrets,
  listStoredMcpConfigs,
  saveStoredMcpConfig,
  saveStoredMcpSecrets,
} from './storage';
import type {
  McpPromptInfo,
  McpResourceInfo,
  McpRuntime,
  McpServerConfig,
  McpServerSecrets,
  McpServerSummary,
  McpToolCallResult,
  McpToolInfo,
} from './types';
import {
  DEFAULT_CALL_TIMEOUT_SECONDS,
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  MAX_TOOLS_PER_SERVER,
  McpApprovalRequiredError,
  McpTransportError,
} from './types';

const MAX_DIAGNOSTIC_LINES = 100;
const MAX_DIAGNOSTIC_LINE_LENGTH = 2_000;
const MAX_LIST_PAGES = 50;

type ConnectionState = {
  config: McpServerConfig;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  bundle?: McpClientBundle;
  capabilities?: ServerCapabilities;
  tools?: McpToolInfo[];
  diagnostics: string[];
  connectPromise?: Promise<void>;
};

const managerListeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of [...managerListeners]) {
    try {
      listener();
    } catch {
      // Listener failures must never break the manager.
    }
  }
}

/** Subscribes to manager state changes (UI refresh). */
export function subscribeToMcpManager(listener: () => void): () => void {
  managerListeners.add(listener);
  return () => {
    managerListeners.delete(listener);
  };
}

let runtime: McpRuntime | null = null;

/** Injects the environment runtime (Tauri app or Node tests). */
export function configureMcpRuntime(next: McpRuntime): void {
  runtime = next;
}

function getRuntime(): McpRuntime {
  if (!runtime) {
    throw new McpTransportError(
      'MCP runtime is not available in this environment.',
    );
  }
  return runtime;
}

/** Auto-selects the Tauri runtime inside the packaged app / dev server. */
export async function ensureMcpRuntime(): Promise<McpRuntime> {
  if (runtime) {
    return runtime;
  }

  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { createTauriMcpRuntime } = await import('./runtime-tauri');
    runtime = createTauriMcpRuntime();
    return runtime;
  }

  return getRuntime();
}

const connections = new Map<string, ConnectionState>();

function getConnection(serverId: string): ConnectionState | undefined {
  return connections.get(serverId);
}

function redactSecretValues(
  text: string,
  secrets: McpServerSecrets,
): string {
  let redacted = text;

  const values: string[] = [];
  if (secrets.bearerToken) {
    values.push(secrets.bearerToken);
  }
  if (secrets.headers) {
    values.push(...Object.values(secrets.headers).filter(Boolean));
  }
  if (secrets.env) {
    values.push(...Object.values(secrets.env).filter(Boolean));
  }

  for (const value of values) {
    if (value.length >= 4) {
      redacted = redacted.split(value).join('***');
    }
  }

  return redacted;
}

function recordDiagnostic(
  state: ConnectionState,
  secrets: McpServerSecrets,
  line: string,
): void {
  const redacted = redactSecretValues(
    line.slice(0, MAX_DIAGNOSTIC_LINE_LENGTH),
    secrets,
  );

  state.diagnostics.push(redacted);
  while (state.diagnostics.length > MAX_DIAGNOSTIC_LINES) {
    state.diagnostics.shift();
  }
}

function disposeConnection(state: ConnectionState): void {
  const bundle = state.bundle;
  state.bundle = undefined;
  state.capabilities = undefined;
  state.tools = undefined;

  if (bundle) {
    void bundle.closeTransport().catch(() => undefined);
  }
}

/**
 * Creates or updates a stored server configuration. Importing or saving
 * never executes third-party code; stdio servers additionally require an
 * approval step before their first execution.
 */
export async function saveMcpServer(
  config: McpServerConfig,
  secrets: McpServerSecrets = {},
): Promise<McpServerConfig> {
  const normalized = validateMcpServerConfig(config);

  // Merge secrets: values provided now override stored ones; omitted fields
  // keep their stored values (the UI only sends non-empty fields).
  const storedSecrets = await getStoredMcpSecrets(normalized.id);
  const merged: McpServerSecrets = {
    ...storedSecrets,
    ...(secrets.env ? { env: { ...(storedSecrets.env ?? {}), ...secrets.env } } : {}),
    ...(secrets.headers
      ? { headers: { ...(storedSecrets.headers ?? {}), ...secrets.headers } }
      : {}),
    ...(secrets.bearerToken ? { bearerToken: secrets.bearerToken } : {}),
  };

  // Any change to a stdio launch configuration revokes the previous
  // execution approval.
  if (normalized.transport === 'stdio') {
    const existing = await getStoredMcpConfig(normalized.id);

    const nextFingerprint = computeStdioFingerprint({
      command: normalized.command,
      args: normalized.args,
      cwd: normalized.cwd,
      env: merged.env ?? {},
    });
    const existingFingerprint = existing
      ? computeStdioFingerprint({
          command: existing.command,
          args: existing.args,
          cwd: existing.cwd,
          env: storedSecrets.env ?? {},
        })
      : undefined;

    if (
      normalized.approvedFingerprint &&
      normalized.approvedFingerprint !== nextFingerprint
    ) {
      normalized.approvedFingerprint = undefined;
    } else if (
      !normalized.approvedFingerprint &&
      existing &&
      existingFingerprint !== undefined &&
      existing.approvedFingerprint === existingFingerprint &&
      existingFingerprint === nextFingerprint
    ) {
      normalized.approvedFingerprint = existingFingerprint;
    }
  }

  await saveStoredMcpConfig(normalized);
  await saveStoredMcpSecrets(normalized.id, merged);

  notifyListeners();
  return normalized;
}

/** Removes a server configuration, secrets, and any live connection. */
export async function removeMcpServer(serverId: string): Promise<void> {
  await disconnectMcpServer(serverId);
  await deleteStoredMcpConfig(serverId);
  await deleteStoredMcpSecrets(serverId);
  notifyListeners();
}

/**
 * Imports an `mcpServers` document: normalizes, validates, extracts secret
 * fields into the secrets store, and persists. Does not connect or execute
 * anything.
 */
export async function importMcpServers(
  text: string,
): Promise<{ imported: number; warnings: string[] }> {
  const { importMcpServersDocument } = await import('./config');
  const result = importMcpServersDocument(text);

  for (const config of result.servers) {
    await saveStoredMcpConfig(config);
    const secrets = result.secrets[config.id] ?? {};
    const existing = await getStoredMcpSecrets(config.id);
    await saveStoredMcpSecrets(config.id, {
      ...existing,
      ...secrets,
      ...(secrets.env ? { env: { ...(existing.env ?? {}), ...secrets.env } } : {}),
      ...(secrets.headers
        ? { headers: { ...(existing.headers ?? {}), ...secrets.headers } }
        : {}),
    });
  }

  notifyListeners();
  return { imported: result.servers.length, warnings: result.warnings };
}

/** Lists stored servers with current connection status and tool counts. */
export async function listMcpServers(): Promise<McpServerSummary[]> {
  const configs = await listStoredMcpConfigs();

  return configs.map((config) => {
    const state = getConnection(config.id);
    const tools = state?.tools ?? [];

    return {
      config,
      status: state?.status ?? 'disconnected',
      ...(state?.error ? { error: state.error } : {}),
      toolCount: tools.length,
      capabilities: {
        tools: Boolean(state?.capabilities?.tools),
        resources: Boolean(state?.capabilities?.resources),
        prompts: Boolean(state?.capabilities?.prompts),
      },
    };
  });
}

export async function getMcpServerDiagnostics(
  serverId: string,
): Promise<string[]> {
  const state = getConnection(serverId);
  return state ? [...state.diagnostics] : [];
}

/**
 * Connects a server: validates config, checks stdio approval, opens the
 * transport, completes initialization/capability negotiation, and discovers
 * tools. Concurrent attempts on the same server are coalesced.
 */
export async function connectMcpServer(
  serverId: string,
  options: { approve?: boolean } = {},
): Promise<McpServerSummary | null> {
  const config = await getStoredMcpConfig(serverId);
  if (!config) {
    return null;
  }

  if (!config.enabled) {
    throw new McpTransportError(
      `MCP server '${config.id}' is disabled. Enable it before connecting.`,
    );
  }

  const existingState = getConnection(serverId);
  if (existingState?.connectPromise) {
    await existingState.connectPromise;
    return buildSummary(config, existingState);
  }

  const secrets = await getStoredMcpSecrets(serverId);
  const activeRuntime = await ensureMcpRuntime();

  // stdio servers require explicit approval before first execution and after
  // any change to the executable configuration.
  if (config.transport === 'stdio') {
    const fingerprint = computeStdioFingerprint({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: secrets.env ?? {},
    });

    if (config.approvedFingerprint !== fingerprint) {
      if (!options.approve) {
        throw new McpApprovalRequiredError(
          `MCP server '${config.id}' runs the local command "${config.command}". ` +
            'Approving starts a third-party process on this machine. Review the command, ' +
            'then approve and connect. Beware of mutable package references such as @latest: ' +
            'their code can change without notice.',
        );
      }

      const approvedConfig: McpServerConfig = {
        ...config,
        approvedFingerprint: fingerprint,
      };
      await saveStoredMcpConfig(approvedConfig);
      config.approvedFingerprint = fingerprint;
    }
  }

  if (existingState) {
    disposeConnection(existingState);
  }

  const state: ConnectionState = {
    config,
    status: 'connecting',
    diagnostics: [],
  };
  connections.set(serverId, state);

  const connectPromise = (async () => {
    const connectTimeoutSeconds =
      config.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS;

    const { client, closeTransport } = await connectMcpClient(
      config,
      secrets,
      activeRuntime,
      connectTimeoutSeconds,
    );

    state.bundle = { client, closeTransport };

    client.onerror = (error) => {
      recordDiagnostic(state, secrets, error.message);
      if (state.status === 'connected') {
        state.status = 'error';
        state.error = error.message;
        notifyListeners();
      }
    };

    client.onclose = () => {
      if (state.bundle && state.status === 'connected') {
        state.status = 'disconnected';
        state.bundle = undefined;
        state.tools = undefined;
        state.capabilities = undefined;
        notifyListeners();
      }
    };

    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      () => {
        void refreshServerTools(serverId).catch(() => undefined);
      },
    );

    state.capabilities = client.getServerCapabilities();
    state.status = 'connected';
    state.error = undefined;

    if (state.capabilities?.tools) {
      await refreshServerTools(serverId);
    }

    notifyListeners();
  })();

  state.connectPromise = connectPromise
    .catch((error) => {
      state.status = 'error';
      state.error =
        error instanceof Error ? error.message : String(error);
      disposeConnection(state);
      notifyListeners();
      throw error;
    })
    .finally(() => {
      state.connectPromise = undefined;
    });

  try {
    await state.connectPromise;
  } catch (error) {
    // The state already recorded the failure for the UI; rethrow so the
    // caller receives the actionable error as well.
    throw error;
  }

  return buildSummary(config, state);
}

function buildSummary(
  config: McpServerConfig,
  state?: ConnectionState,
): McpServerSummary {
  return {
    config,
    status: state?.status ?? 'disconnected',
    ...(state?.error ? { error: state.error } : {}),
    toolCount: state?.tools?.length ?? 0,
    capabilities: {
      tools: Boolean(state?.capabilities?.tools),
      resources: Boolean(state?.capabilities?.resources),
      prompts: Boolean(state?.capabilities?.prompts),
    },
  };
}

async function fetchAllTools(
  client: Client,
  callTimeoutSeconds: number,
): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const response = await client.listTools(
      cursor ? { cursor } : undefined,
      { timeout: callTimeoutSeconds * 1000 },
    );

    for (const tool of response.tools) {
      if (tools.length >= MAX_TOOLS_PER_SERVER) {
        throw new McpTransportError(
          `The MCP server exposes more than ${MAX_TOOLS_PER_SERVER} tools; the remainder were not loaded.`,
        );
      }

      tools.push({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
        ...(tool.outputSchema
          ? { outputSchema: tool.outputSchema as Record<string, unknown> }
          : {}),
      });
    }

    cursor = response.nextCursor ?? undefined;
    pages += 1;

    if (pages > MAX_LIST_PAGES) {
      throw new McpTransportError(
        'Tool listing did not terminate within the pagination limit.',
      );
    }
  } while (cursor);

  return tools;
}

/** Re-runs tools/list (following pagination) and refreshes the cache. */
export async function refreshServerTools(
  serverId: string,
): Promise<McpToolInfo[]> {
  const state = getConnection(serverId);
  if (!state?.bundle) {
    throw new McpTransportError(
      `MCP server '${serverId}' is not connected.`,
    );
  }

  const callTimeoutSeconds =
    state.config.timeoutSeconds ?? DEFAULT_CALL_TIMEOUT_SECONDS;

  const tools = await fetchAllTools(state.bundle.client, callTimeoutSeconds);
  state.tools = tools;
  notifyListeners();
  return tools;
}

/** Returns the cached discovered tools for a server. */
export async function getMcpServerTools(
  serverId: string,
): Promise<McpToolInfo[]> {
  const state = getConnection(serverId);
  return state?.tools ?? [];
}

/**
 * Disconnects a server. For stdio this stops the local child process; for
 * HTTP transports this only closes Mocu's client-side session and never
 * attempts to shut down the remote server.
 */
export async function disconnectMcpServer(serverId: string): Promise<boolean> {
  const state = getConnection(serverId);
  if (!state) {
    return false;
  }

  connections.delete(serverId);
  disposeConnection(state);
  notifyListeners();
  return true;
}

/**
 * Invokes a tool on a connected server.
 *
 * Execution flow (used by Mocu's agent adapters):
 *   resolve tool -> validate arguments -> ensure connection -> tools/call
 *   -> normalize result
 *
 * The call is never retried or replayed here after a failure.
 */
export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
  options: {
    signal?: AbortSignal;
    timeoutSeconds?: number;
  } = {},
): Promise<McpToolCallResult> {
  const state = getConnection(serverId);
  if (!state?.bundle) {
    throw new McpTransportError(
      `MCP server '${serverId}' is not connected. Connect it before calling its tools.`,
    );
  }

  if (!state.tools?.some((tool) => tool.name === toolName)) {
    throw new Error(
      `MCP server '${serverId}' does not expose a tool named '${toolName}'.`,
    );
  }

  validateToolArguments(state.tools, toolName, args);

  const timeoutSeconds =
    options.timeoutSeconds ?? state.config.timeoutSeconds ?? DEFAULT_CALL_TIMEOUT_SECONDS;

  try {
    const raw = await state.bundle.client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      undefined,
      {
        timeout: timeoutSeconds * 1000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );

    return normalizeToolCallResult(raw);
  } catch (error) {
    // Abort signals surface as the signal's error; pass through untouched.
    if (options.signal?.aborted) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    // Protocol/transport-level failures must be distinguishable from tool
    // execution results.
    if (error instanceof Error && error.name === 'McpError') {
      throw new Error(`MCP protocol error from '${serverId}/${toolName}': ${message}`);
    }

    throw new McpTransportError(
      `Failed to call '${toolName}' on MCP server '${serverId}': ${message}`,
    );
  }
}

/**
 * Validates tool arguments against the discovered input schema. Mocu checks
 * required fields and basic types here in addition to the adapter-level
 * schema validation, because the tool list can change between discovery
 * and execution.
 */
function validateToolArguments(
  tools: McpToolInfo[],
  toolName: string,
  args: Record<string, unknown>,
): void {
  const tool = tools.find((item) => item.name === toolName);
  if (!tool) {
    throw new Error(`Unknown MCP tool '${toolName}'.`);
  }

  const schema = tool.inputSchema as {
    type?: string;
    required?: string[];
    properties?: Record<string, unknown>;
  } | undefined;

  if (!schema || schema.type !== 'object') {
    return;
  }

  if (!args || typeof args !== 'object') {
    throw new Error(
      `Tool '${toolName}' requires an object argument record.`,
    );
  }

  for (const required of schema.required ?? []) {
    if (!(required in args)) {
      throw new Error(
        `Tool '${toolName}' is missing the required argument '${required}'.`,
      );
    }
  }
}

/** Lists resources when the server supports them. */
export async function listMcpResources(
  serverId: string,
): Promise<McpResourceInfo[]> {
  const state = requireCapability(serverId, 'resources', 'resources/list');

  const response = await state.bundle!.client.listResources(
    undefined,
    {
      timeout: (state.config.timeoutSeconds ?? DEFAULT_CALL_TIMEOUT_SECONDS) * 1000,
    },
  );

  return response.resources.map((resource) => ({
    uri: resource.uri,
    name: resource.name ?? resource.uri,
    ...(resource.description ? { description: resource.description } : {}),
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
  }));
}

/** Reads one resource when the server supports it. */
export async function readMcpResource(
  serverId: string,
  uri: string,
): Promise<string> {
  const state = requireCapability(serverId, 'resources', 'resources/read');

  const response = await state.bundle!.client.readResource(
    { uri },
    {
      timeout: (state.config.timeoutSeconds ?? DEFAULT_CALL_TIMEOUT_SECONDS) * 1000,
    },
  );

  const parts: string[] = [];
  for (const content of response.contents) {
    if ('text' in content && typeof content.text === 'string') {
      parts.push(`[${content.uri}]\n${content.text}`);
    } else if ('blob' in content && typeof content.blob === 'string') {
      parts.push(
        `[${content.uri} (${content.mimeType ?? 'unknown type'}, binary content not displayed)]`,
      );
    }
  }

  return parts.join('\n\n');
}

/** Lists prompts when the server supports them. */
export async function listMcpPrompts(
  serverId: string,
): Promise<McpPromptInfo[]> {
  const state = requireCapability(serverId, 'prompts', 'prompts/list');

  const response = await state.bundle!.client.listPrompts(
    undefined,
    {
      timeout: (state.config.timeoutSeconds ?? DEFAULT_CALL_TIMEOUT_SECONDS) * 1000,
    },
  );

  return response.prompts.map((prompt) => ({
    name: prompt.name,
    ...(prompt.description ? { description: prompt.description } : {}),
  }));
}

function requireCapability(
  serverId: string,
  capability: keyof ServerCapabilities,
  method: string,
): ConnectionState & { bundle: McpClientBundle } {
  const state = getConnection(serverId);
  if (!state?.bundle) {
    throw new McpTransportError(
      `MCP server '${serverId}' is not connected.`,
    );
  }

  if (!state.capabilities?.[capability]) {
    throw new McpTransportError(
      `MCP server '${serverId}' does not support ${String(capability)} (no capability negotiated for ${method}).`,
    );
  }

  return state as ConnectionState & { bundle: McpClientBundle };
}

/**
 * Stops every connection and kills every local server process. Called on
 * application shutdown; the Rust host performs the final process sweep.
 */
export async function shutdownMcpManager(): Promise<void> {
  const serverIds = [...connections.keys()];
  for (const serverId of serverIds) {
    await disconnectMcpServer(serverId);
  }
}
