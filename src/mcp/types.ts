/**
 * Core MCP (Model Context Protocol) types for Mocu.
 *
 * Mocu is the MCP host: it connects to external MCP servers through the
 * official TypeScript SDK and exposes their discovered tools to its agents
 * through the normal LangChain tool pipeline.
 */

/**
 * Supported MCP transports.
 *
 * - `stdio`: a local server process started from a configured executable.
 * - `streamable-http`: the current HTTP transport (local or remote endpoint).
 * - `sse`: legacy HTTP+SSE compatibility for older servers.
 */
export type McpTransportKind = 'stdio' | 'streamable-http' | 'sse';

export type McpAuthType = 'none' | 'bearer' | 'headers';

/**
 * Normalized server configuration (internal schema). Secret values
 * (bearer token, secret headers, secret env values) are stored separately
 * in the MCP secrets store, never here.
 */
export type McpServerConfig = {
  /** Stable, collision-safe server id (e.g. "chrome-devtools"). */
  id: string;

  /** Human-readable display name. */
  name: string;

  /**
   * Human-readable description of what the server provides. Shown to the
   * agent in the system prompt when the server is selected for a request.
   */
  description?: string;

  transport: McpTransportKind;

  enabled: boolean;

  /** stdio: executable to start. */
  command?: string;
  /** stdio: arguments passed verbatim. */
  args?: string[];
  /** stdio: working directory. */
  cwd?: string;

  /** Remote transports: server endpoint. */
  url?: string;

  /**
   * Explicit insecure HTTP override for non-local endpoints. Plain HTTP is
   * rejected for non-local URLs unless this is true.
   */
  allowInsecureHttp?: boolean;

  /** none | bearer token | custom headers (secret values live in the secrets store). */
  authType: McpAuthType;

  /** Per-request timeout in seconds (tools/call and other requests). */
  timeoutSeconds?: number;

  /** Connection/initialization timeout in seconds. */
  connectTimeoutSeconds?: number;

  /**
   * Approved stdio launch fingerprint. Connecting a stdio server whose
   * command/args/cwd/env fingerprint differs requires explicit re-approval.
   */
  approvedFingerprint?: string;

  /** Non-fatal warnings from normalization (unsupported fields, assumptions). */
  notes?: string[];
};

/** Secret material for one server, kept out of the ordinary configuration. */
export type McpServerSecrets = {
  /** stdio: environment variables (may contain API keys). */
  env?: Record<string, string>;
  /** bearer token used as `Authorization: Bearer <token>`. */
  bearerToken?: string;
  /** custom HTTP headers for remote transports. */
  headers?: Record<string, string>;
};

export type McpConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/** A tool discovered from a server via tools/list (pagination followed). */
export type McpToolInfo = {
  /** Original MCP tool name on the server. */
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema for structured output, when the server provides one. */
  outputSchema?: Record<string, unknown>;
};

export type McpServerSummary = {
  config: McpServerConfig;
  status: McpConnectionStatus;
  error?: string;
  toolCount: number;
  capabilities: {
    tools: boolean;
    resources: boolean;
    prompts: boolean;
  };
};

/** Result of invoking an MCP tool, normalized for Mocu's text pipeline. */
export type McpToolCallResult = {
  /** Textual representation (bounded) safe to feed to the model. */
  text: string;
  /** True when the MCP tool itself reported an error (isError). */
  isError: boolean;
  /** Raw structured content, when the server provided it. */
  structuredContent?: unknown;
};

export type McpResourceInfo = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpPromptInfo = {
  name: string;
  description?: string;
};

/** Runtime plumbing injected per environment (Tauri app vs Node tests). */
export type McpRuntime = {
  /** Spawns stdio MCP server processes. */
  spawnHost: McpStdioSpawnHost;
  /**
   * Fetch implementation for remote transports. The Tauri runtime provides
   * the Rust-backed fetch (no CORS); tests use the global fetch.
   */
  fetchImpl?: typeof globalThis.fetch;
};

/**
 * Process handle for one running stdio MCP server. One process per server
 * connection, shared by all tool calls on that connection.
 */
export interface McpStdioProcessHandle {
  /** Sends one JSON-RPC message line to the server's stdin. */
  send(message: string): Promise<void>;
  /** Kills the process. */
  stop(): Promise<void>;
  /** Bounded stderr diagnostics captured so far. */
  readStderr(): Promise<string[]>;
}

export interface McpStdioSpawnHost {
  start(
    id: string,
    spec: {
      command: string;
      args: string[];
      cwd?: string;
      env: Record<string, string>;
    },
    handlers: {
      onMessage: (line: string) => void;
      onStderr: (line: string) => void;
      onExit: () => void;
    },
  ): Promise<McpStdioProcessHandle>;
}

/** Error raised when a stdio server needs explicit user approval. */
export class McpApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpApprovalRequiredError';
  }
}

/** Error raised for connection/transport problems (distinct from tool errors). */
export class McpTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpTransportError';
  }
}

export const DEFAULT_CALL_TIMEOUT_SECONDS = 60;
export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 60;
export const MAX_MCP_TOOL_RESULT_LENGTH = 20_000;
export const MAX_TOOLS_PER_SERVER = 200;
