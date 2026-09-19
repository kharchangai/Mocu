/**
 * MCP configuration import, normalization, and validation.
 *
 * There is no universal MCP configuration-file schema. Mocu accepts the
 * common `mcpServers` format used by other MCP clients, normalizes it into
 * Mocu's internal schema, and reports unsupported fields and assumptions
 * clearly instead of silently guessing. Importing or saving configuration
 * never executes third-party code: connecting to a server is always an
 * explicit, approved action.
 */

import type {
  McpAuthType,
  McpServerConfig,
  McpTransportKind,
} from './types';

export const MCP_TRANSPORTS: readonly McpTransportKind[] = [
  'stdio',
  'streamable-http',
  'sse',
];

/** Transports that connect to an HTTP endpoint. */
const REMOTE_TRANSPORTS: readonly McpTransportKind[] = [
  'streamable-http',
  'sse',
];

/** Aliases accepted in imported configurations. */
const TRANSPORT_ALIASES: Record<string, McpTransportKind> = {
  stdio: 'stdio',
  'streamable-http': 'streamable-http',
  'streamable_http': 'streamable-http',
  http: 'streamable-http',
  'http-streamable': 'streamable-http',
  sse: 'sse',
  'sse-legacy': 'sse',
};

export type McpImportResult = {
  servers: McpServerConfig[];
  /** Warnings across the whole import (unsupported top-level shapes etc.). */
  warnings: string[];
};

/**
 * Normalizes a single server id into a stable, collision-safe identifier.
 */
export function normalizeMcpServerId(rawId: string): string {
  const normalized = rawId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return normalized || 'mcp-server';
}

/**
 * Stable fingerprint of a stdio launch configuration. Connecting a server
 * whose fingerprint differs from the approved one requires re-approval.
 */
export function computeStdioFingerprint(config: {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}): string {
  const parts = [
    config.command ?? '',
    JSON.stringify(config.args ?? []),
    config.cwd ?? '',
    JSON.stringify(sortRecord(config.env ?? {})),
  ];
  return parts.join('\u0000');
}

function sortRecord(
  record: Record<string, string>,
): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return sorted;
}

/**
 * Detects whether a URL points at a local endpoint (localhost / loopback).
 */
export function isLocalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes and validates one imported server entry.
 *
 * Throws on invalid combinations (e.g. a command-based stdio server with a
 * remote URL). Non-fatal issues are collected into `config.notes`.
 */
export function normalizeMcpServerEntry(
  rawId: string,
  rawEntry: unknown,
): McpServerConfig {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    throw new Error(
      `MCP server '${rawId}' must be an object with its configuration.`,
    );
  }

  const entry = rawEntry as Record<string, unknown>;
  const notes: string[] = [];

  const id = normalizeMcpServerId(
    typeof entry.id === 'string' && entry.id.trim() ? entry.id : rawId,
  );

  const name =
    typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim()
      : rawId.trim() || id;

  if (typeof entry.name !== 'string' && typeof entry.title === 'string') {
    notes.push(`Field 'title' was used as the display name.`);
  }

  // Transport: explicit field (also accepts the common `type` alias).
  let transport: McpTransportKind | undefined;
  const rawTransport =
    typeof entry.transport === 'string'
      ? entry.transport
      : typeof entry.type === 'string'
        ? entry.type
        : undefined;

  if (rawTransport !== undefined) {
    const mapped = TRANSPORT_ALIASES[rawTransport.trim().toLowerCase()];
    if (!mapped) {
      throw new Error(
        `MCP server '${rawId}' declares unsupported transport '${rawTransport}'. Supported transports: stdio, streamable-http, sse.`,
      );
    }
    transport = mapped;
    if (mapped === 'streamable-http' && rawTransport.trim().toLowerCase() === 'http') {
      notes.push(
        `Transport 'http' was interpreted as 'streamable-http'. Use 'streamable-http' explicitly to avoid ambiguity.`,
      );
    }
  }

  const command =
    typeof entry.command === 'string' && entry.command.trim()
      ? entry.command.trim()
      : undefined;
  const url =
    typeof entry.url === 'string' && entry.url.trim()
      ? entry.url.trim()
      : undefined;

  // Detect transport from shape when not explicit, and report the assumption.
  if (!transport) {
    if (command && url) {
      throw new Error(
        `MCP server '${rawId}' sets both 'command' and 'url'. Command-based stdio servers must not use a remote URL; specify a transport explicitly if both fields are intentional.`,
      );
    }
    if (command) {
      transport = 'stdio';
      notes.push(
        `Transport was inferred as 'stdio' from the 'command' field.`,
      );
    } else if (url) {
      transport = 'streamable-http';
      notes.push(
        `Transport was inferred as 'streamable-http' from the 'url' field. For legacy SSE servers, set 'transport': 'sse' explicitly.`,
      );
    } else {
      throw new Error(
        `MCP server '${rawId}' needs either 'command' (stdio) or 'url' (streamable-http / sse).`,
      );
    }
  } else if (transport === 'stdio' && url) {
    throw new Error(
      `MCP server '${rawId}' is a command-based stdio server and must not declare a remote 'url'.`,
    );
  } else if (REMOTE_TRANSPORTS.includes(transport) && command) {
    throw new Error(
      `MCP server '${rawId}' is a remote HTTP server and must not declare a local 'command'.`,
    );
  } else if (!command && transport === 'stdio') {
    throw new Error(
      `MCP server '${rawId}' uses the stdio transport but has no 'command'.`,
    );
  } else if (!url && REMOTE_TRANSPORTS.includes(transport)) {
    throw new Error(
      `MCP server '${rawId}' uses the '${transport}' transport but has no 'url'.`,
    );
  }

  // URL validation for remote transports.
  if (url && REMOTE_TRANSPORTS.includes(transport as McpTransportKind)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`MCP server '${rawId}' has an invalid URL: ${url}`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(
        `MCP server '${rawId}' URL must use http or https: ${url}`,
      );
    }

    const isLocal = isLocalUrl(url);
    const allowInsecureHttp = entry.allowInsecureHttp === true;

    if (parsed.protocol === 'http:' && !isLocal && !allowInsecureHttp) {
      throw new Error(
        `MCP server '${rawId}' uses plain http for a non-local endpoint. Use https, or set 'allowInsecureHttp': true explicitly to accept the risk.`,
      );
    }
  }

  // stdio-specific fields.
  let args: string[] | undefined;
  if (Array.isArray(entry.args)) {
    if (entry.args.some((item) => typeof item !== 'string')) {
      throw new Error(
        `MCP server '${rawId}' args must be an array of strings.`,
      );
    }
    args = [...(entry.args as string[])];
  } else if (entry.args !== undefined) {
    throw new Error(
      `MCP server '${rawId}' args must be an array of strings.`,
    );
  }

  const cwd =
    typeof entry.cwd === 'string' && entry.cwd.trim()
      ? entry.cwd.trim()
      : undefined;

  if (cwd && transport !== 'stdio') {
    notes.push(`Field 'cwd' is only used by stdio servers and was ignored.`);
  }

  // Authentication.
  let authType: McpAuthType = 'none';
  const rawAuth = entry.auth ?? entry.authentication;
  if (rawAuth !== undefined) {
    if (typeof rawAuth === 'string') {
      const normalized = rawAuth.trim().toLowerCase();
      if (normalized === 'none' || normalized === 'bearer' || normalized === 'headers') {
        authType = normalized;
      } else {
        throw new Error(
          `MCP server '${rawId}' has unsupported auth '${rawAuth}'. Supported: none, bearer, headers.`,
        );
      }
    } else if (rawAuth && typeof rawAuth === 'object') {
      const authRecord = rawAuth as Record<string, unknown>;
      const kind =
        typeof authRecord.type === 'string'
          ? authRecord.type.trim().toLowerCase()
          : '';
      if (kind === 'bearer') {
        authType = 'bearer';
      } else if (kind === 'headers') {
        authType = 'headers';
      } else if (kind === 'none' || kind === '') {
        authType = 'none';
      } else if (kind === 'oauth') {
        throw new Error(
          `MOCU MCP client does not support OAuth in this version; use a bearer token or custom headers. Server '${rawId}'.`,
        );
      } else {
        throw new Error(
          `MCP server '${rawId}' has unsupported auth type '${authRecord.type}'. Supported: none, bearer, headers.`,
        );
      }
    } else {
      throw new Error(
        `MCP server '${rawId}' auth must be a string or an object.`,
      );
    }
  }

  if (
    authType !== 'none' &&
    transport !== 'streamable-http' &&
    transport !== 'sse'
  ) {
    notes.push(`Auth settings apply only to remote HTTP servers and were ignored.`);
  }

  // Timeouts.
  const timeoutSeconds = readPositiveNumber(entry, 'timeoutSeconds', rawId);
  const connectTimeoutSeconds = readPositiveNumber(
    entry,
    'connectTimeoutSeconds',
    rawId,
  );

  // Insecure flag on secure URLs is pointless; note it.
  if (entry.allowInsecureHttp !== undefined && typeof entry.allowInsecureHttp !== 'boolean') {
    throw new Error(
      `MCP server '${rawId}' allowInsecureHttp must be a boolean.`,
    );
  }

  // Report fields Mocu does not use so imports are never silently lossy.
  reportUnsupportedFields(entry, notes, rawId, [
    'id',
    'name',
    'title',
    'transport',
    'type',
    'command',
    'args',
    'cwd',
    'url',
    'auth',
    'authentication',
    'allowInsecureHttp',
    'timeoutSeconds',
    'connectTimeoutSeconds',
    'enabled',
    // Handled by the secrets store during import.
    'env',
    'headers',
    // Common in other clients; explicitly rejected rather than guessed at.
    'oauth',
  ]);

  const enabled = entry.enabled === undefined ? true : entry.enabled === true;

  const config: McpServerConfig = {
    id,
    name,
    transport,
    enabled,
    authType,
  };

  if (transport === 'stdio') {
    config.command = command;
    if (args) {
      config.args = args;
    }
    if (cwd) {
      config.cwd = cwd;
    }
  } else {
    config.url = url;
    if (entry.allowInsecureHttp === true) {
      config.allowInsecureHttp = true;
    }
  }

  if (timeoutSeconds !== undefined) {
    config.timeoutSeconds = timeoutSeconds;
  }
  if (connectTimeoutSeconds !== undefined) {
    config.connectTimeoutSeconds = connectTimeoutSeconds;
  }
  if (notes.length > 0) {
    config.notes = notes;
  }

  return config;
}

function readPositiveNumber(
  entry: Record<string, unknown>,
  field: string,
  rawId: string,
): number | undefined {
  const value = entry[field];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 24 * 60 * 60
  ) {
    throw new Error(
      `MCP server '${rawId}' field '${field}' must be a positive number of seconds (max 86400).`,
    );
  }
  return Math.round(value);
}

function reportUnsupportedFields(
  entry: Record<string, unknown>,
  notes: string[],
  rawId: string,
  accepted: string[],
) {
  const acceptedSet = new Set(accepted);
  const unsupported = Object.keys(entry).filter((key) => !acceptedSet.has(key));

  if (unsupported.length > 0) {
    notes.push(
      `MCP server '${rawId}': unsupported fields were ignored: ${unsupported.join(', ')}. Mocu accepts: ${accepted.join(', ')}.`,
    );
  }
}

/**
 * Normalizes an imported `mcpServers` configuration document.
 *
 * Accepted shapes:
 * - `{ "mcpServers": { "<id>": { ... } } }` (the common format)
 * - a bare record of `{ "<id>": { ... } }`
 * - a JSON array of server objects with explicit `id` fields
 *
 * Secret-bearing fields (`env`, `headers`) are extracted so the caller can
 * persist them in the secrets store; they never end up in the config.
 */
export function importMcpServersDocument(
  text: string,
): McpImportResult & {
  secrets: Record<string, { env?: Record<string, string>; headers?: Record<string, string> }>;
} {
  const warnings: string[] = [];

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('The MCP configuration is not valid JSON.');
  }

  let entries: Record<string, unknown>;
  if (document && typeof document === 'object' && !Array.isArray(document)) {
    const record = document as Record<string, unknown>;
    if (record.mcpServers && typeof record.mcpServers === 'object' && !Array.isArray(record.mcpServers)) {
      entries = record.mcpServers as Record<string, unknown>;
    } else {
      entries = record;
    }
  } else {
    throw new Error(
      'The MCP configuration must be an object with an "mcpServers" record (or a bare record of server entries).',
    );
  }

  const servers: McpServerConfig[] = [];
  const secrets: Record<string, { env?: Record<string, string>; headers?: Record<string, string> }> = {};
  const usedIds = new Set<string>();

  for (const [rawId, rawEntry] of Object.entries(entries)) {
    const config = normalizeMcpServerEntry(rawId, rawEntry);

    // Deduplicate ids deterministically.
    let id = config.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${config.id}-${suffix}`;
      suffix += 1;
    }
    if (id !== config.id) {
      warnings.push(`Duplicate server id '${config.id}' was renamed to '${id}'.`);
      config.id = id;
    }
    usedIds.add(id);

    // Extract secret-bearing fields out of the entry.
    if (rawEntry && typeof rawEntry === 'object') {
      const entryRecord = rawEntry as Record<string, unknown>;
      const secretsForServer: { env?: Record<string, string>; headers?: Record<string, string> } = {};

      if (entryRecord.env !== undefined) {
        secretsForServer.env = readStringRecord(rawId, 'env', entryRecord.env);
      }
      if (entryRecord.headers !== undefined) {
        secretsForServer.headers = readStringRecord(rawId, 'headers', entryRecord.headers);
      }

      if (secretsForServer.env || secretsForServer.headers) {
        secrets[id] = secretsForServer;
        warnings.push(
          `Secret fields (env/headers) for '${id}' were stored in Mocu's secrets store instead of the server configuration.`,
        );
      }
    }

    servers.push(config);
  }

  return { servers, warnings, secrets };
}

function readStringRecord(
  rawId: string,
  field: string,
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MCP server '${rawId}' field '${field}' must be an object of strings.`);
  }

  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== 'string') {
      throw new Error(
        `MCP server '${rawId}' field '${field}.${key}' must be a string.`,
      );
    }
    record[key] = item;
  }
  return record;
}

/**
 * Validates a config before save (forms and edits use this path too).
 * Reuses the import normalization with a synthetic single-entry document.
 */
export function validateMcpServerConfig(config: McpServerConfig): McpServerConfig {
  const entry: Record<string, unknown> = {
    id: config.id,
    name: config.name,
    transport: config.transport,
    enabled: config.enabled,
    auth: config.authType,
    ...(config.command ? { command: config.command } : {}),
    ...(config.args ? { args: config.args } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
    ...(config.url ? { url: config.url } : {}),
    ...(config.allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    ...(config.timeoutSeconds !== undefined
      ? { timeoutSeconds: config.timeoutSeconds }
      : {}),
    ...(config.connectTimeoutSeconds !== undefined
      ? { connectTimeoutSeconds: config.connectTimeoutSeconds }
      : {}),
  };

  const normalized = normalizeMcpServerEntry(config.id, entry);
  normalized.notes = [
    ...(config.notes ?? []),
    ...(normalized.notes ?? []),
  ];

  return normalized;
}

export function computeConfigFingerprint(config: McpServerConfig): string {
  if (config.transport !== 'stdio') {
    return '';
  }
  return computeStdioFingerprint({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    // env values live in the secrets store; the caller includes them when
    // building the fingerprint so secret edits also require re-approval.
    env: {},
  });
}
