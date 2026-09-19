import { useCallback, useEffect, useMemo, useState } from 'react';

import { confirm } from '@tauri-apps/plugin-dialog';

import { importMcpServers } from '../manager';
import {
  connectMcpServer,
  disconnectMcpServer,
  ensureMcpRuntime,
  getMcpServerDiagnostics,
  listMcpServers,
  refreshServerTools,
  removeMcpServer,
  saveMcpServer,
  subscribeToMcpManager,
} from '../manager';
import {
  McpApprovalRequiredError,
  type McpServerConfig,
  type McpServerSummary,
  type McpToolInfo,
} from '../types';
import './mcp.css';

type FormState = {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  enabled: boolean;
  command: string;
  args: string;
  cwd: string;
  url: string;
  allowInsecureHttp: boolean;
  authType: 'none' | 'bearer' | 'headers';
  bearerToken: string;
  headers: string;
  env: string;
  timeoutSeconds: string;
  connectTimeoutSeconds: string;
};

const emptyForm = (): FormState => ({
  id: '',
  name: '',
  transport: 'streamable-http',
  enabled: true,
  command: '',
  args: '',
  cwd: '',
  url: '',
  allowInsecureHttp: false,
  authType: 'none',
  bearerToken: '',
  headers: '',
  env: '',
  timeoutSeconds: '',
  connectTimeoutSeconds: '',
});

function parseJsonRecord(text: string): Record<string, string> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object of string values.');
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new Error(`"${key}" must be a string.`);
    }
    record[key] = value;
  }
  return record;
}

function formToDraft(form: FormState): { config: McpServerConfig; secrets: Record<string, string> } {
  const timeout = Number(form.timeoutSeconds);
  const connectTimeout = Number(form.connectTimeoutSeconds);

  const config: McpServerConfig = {
    id: form.id,
    name: form.name.trim() || form.id,
    transport: form.transport,
    enabled: form.enabled,
    authType: form.authType,
  };

  if (form.transport === 'stdio') {
    config.command = form.command.trim();
    config.args = form.args
      .split('\n')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (form.cwd.trim()) {
      config.cwd = form.cwd.trim();
    }
  } else {
    config.url = form.url.trim();
    if (form.allowInsecureHttp) {
      config.allowInsecureHttp = true;
    }
  }

  if (Number.isFinite(timeout) && timeout > 0) {
    config.timeoutSeconds = Math.round(timeout);
  }
  if (Number.isFinite(connectTimeout) && connectTimeout > 0) {
    config.connectTimeoutSeconds = Math.round(connectTimeout);
  }

  // Everything secret-shaped goes to the secrets store, never the config.
  const secrets: Record<string, string> = {};
  if (form.bearerToken.trim()) {
    secrets['__bearerToken'] = form.bearerToken;
  }
  for (const [key, value] of Object.entries(parseJsonRecord(form.headers))) {
    secrets[`__header:${key}`] = value;
  }
  for (const [key, value] of Object.entries(parseJsonRecord(form.env))) {
    secrets[`__env:${key}`] = value;
  }

  return { config, secrets };
}

export function McpPage() {
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  const [editorTarget, setEditorTarget] = useState<
    { mode: 'add' } | { mode: 'edit'; serverId: string } | null
  >(null);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [diagnostics, setDiagnostics] = useState<
    Record<string, string[]>
  >({});
  const [toolCache, setToolCache] = useState<Record<string, McpToolInfo[]>>(
    {},
  );

  /*
   * The tool list of a server stays collapsed by default. Clicking
   * "Show tools" loads (once) and reveals every tool the server exposes;
   * "Hide tools" collapses it again.
   */
  const [expandedTools, setExpandedTools] = useState<Set<string>>(
    () => new Set(),
  );

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const summaries = await listMcpServers();
      setServers(summaries);

      // Tool lists are loaded on demand (per-card "Show tools"), so a page
      // refresh never pulls every tool list of every connected server.
      setToolCache((current) => {
        const connectedIds = new Set(
          summaries
            .filter((summary) => summary.status === 'connected')
            .map((summary) => summary.config.id),
        );

        const next: Record<string, McpToolInfo[]> = {};
        for (const [serverId, tools] of Object.entries(current)) {
          if (connectedIds.has(serverId)) {
            next[serverId] = tools;
          }
        }
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await ensureMcpRuntime();
      } catch (error) {
        setPageError(
          error instanceof Error ? error.message : 'MCP runtime is unavailable.',
        );
      }
      await refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    return subscribeToMcpManager(() => {
      void refresh();
    });
  }, [refresh]);

  const withBusy = useCallback(
    async (id: string, action: () => Promise<unknown>): Promise<void> => {
      setBusyIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });
      setPageError(null);

      try {
        await action();
        await refresh();
      } catch (reason) {
        setPageError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh],
  );

  const openAdd = useCallback(() => {
    setForm(emptyForm());
    setEditorTarget({ mode: 'add' });
  }, []);

  const openEdit = useCallback((summary: McpServerSummary) => {
    const { config } = summary;
    setForm({
      id: config.id,
      name: config.name,
      transport: config.transport,
      enabled: config.enabled,
      command: config.command ?? '',
      args: (config.args ?? []).join('\n'),
      cwd: config.cwd ?? '',
      url: config.url ?? '',
      allowInsecureHttp: config.allowInsecureHttp === true,
      authType: config.authType,
      bearerToken: '',
      headers: '',
      env: '',
      timeoutSeconds: config.timeoutSeconds ? String(config.timeoutSeconds) : '',
      connectTimeoutSeconds: config.connectTimeoutSeconds
        ? String(config.connectTimeoutSeconds)
        : '',
    });
    setEditorTarget({ mode: 'edit', serverId: config.id });
  }, []);

  const handleSaveForm = useCallback(async (): Promise<void> => {
    if (!editorTarget) {
      return;
    }

    const { config, secrets } = formToDraft(form);

    // Encode the secret-shaped values into the secrets record shape used by
    // the storage layer.
    const bearerToken = secrets['__bearerToken'];
    const headers: Record<string, string> = {};
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(secrets)) {
      if (key.startsWith('__header:')) {
        headers[key.slice('__header:'.length)] = value;
      } else if (key.startsWith('__env:')) {
        env[key.slice('__env:'.length)] = value;
      }
    }

    await saveMcpServer(config, {
      ...(bearerToken ? { bearerToken } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    });

    setEditorTarget(null);
    await refresh();
  }, [editorTarget, form, refresh]);

  const handleImport = useCallback(async (): Promise<void> => {
    const result = await importMcpServers(importText);
    setImportWarnings(result.warnings);
    if (result.imported > 0) {
      await refresh();
    }
  }, [importText, refresh]);

  const handleTest = useCallback(
    (summary: McpServerSummary): Promise<void> =>
      withBusy(summary.config.id, async () => {
        try {
          await connectMcpServer(summary.config.id);
        } catch (error) {
          if (!(error instanceof McpApprovalRequiredError)) {
            throw error;
          }

          const config = summary.config;
          const command = [config.command, ...(config.args ?? [])]
            .filter((part): part is string => Boolean(part))
            .map((part) => (/[\\s"]/.test(part) ? JSON.stringify(part) : part))
            .join(' ');

          const approved = await confirm(
            `Mocu is about to start this local MCP process:\n\n${command}\n\n` +
              'The package may be downloaded and executed on this machine. ' +
              'Only approve it if you trust this command and its package.',
            {
              title: 'Approve MCP server',
              kind: 'warning',
            },
          );

          if (!approved) {
            return;
          }

          await connectMcpServer(summary.config.id, { approve: true });
        }
      }),
    [withBusy],
  );

  const handleDisconnect = useCallback(
    (summary: McpServerSummary): Promise<void> =>
      withBusy(summary.config.id, () => disconnectMcpServer(summary.config.id)),
    [withBusy],
  );

  const handleRemove = useCallback(
    (summary: McpServerSummary): Promise<void> =>
      withBusy(summary.config.id, () => removeMcpServer(summary.config.id)),
    [withBusy],
  );

  const handleToggleEnabled = useCallback(
    (summary: McpServerSummary): Promise<void> =>
      withBusy(summary.config.id, async () => {
        const nextConfig: McpServerConfig = {
          ...summary.config,
          enabled: !summary.config.enabled,
        };
        await saveMcpServer(nextConfig, {});
        if (!nextConfig.enabled) {
          await disconnectMcpServer(summary.config.id);
        }
      }),
    [withBusy],
  );

  const handleLoadDiagnostics = useCallback(
    async (summary: McpServerSummary): Promise<void> => {
      const lines = await getMcpServerDiagnostics(summary.config.id);
      setDiagnostics((current) => ({ ...current, [summary.config.id]: lines }));
    },
    [],
  );

  const handleLoadTools = useCallback(
    async (summary: McpServerSummary): Promise<void> => {
      const tools = await refreshServerTools(summary.config.id);
      setToolCache((current) => ({ ...current, [summary.config.id]: tools }));
    },
    [],
  );

  const handleToggleTools = useCallback(
    async (summary: McpServerSummary): Promise<void> => {
      const serverId = summary.config.id;
      const isExpanded = expandedTools.has(serverId);

      if (isExpanded) {
        setExpandedTools((current) => {
          const next = new Set(current);
          next.delete(serverId);
          return next;
        });
        return;
      }

      setExpandedTools((current) => new Set(current).add(serverId));

      // Load the tool list the first time the card is expanded.
      if ((toolCache[serverId] ?? []).length === 0) {
        try {
          const tools = await refreshServerTools(serverId);
          setToolCache((current) => ({ ...current, [serverId]: tools }));
        } catch (reason) {
          setPageError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    },
    [expandedTools, toolCache],
  );


  const sortedServers = useMemo(
    () => [...servers].sort((first, second) => first.config.name.localeCompare(second.config.name)),
    [servers],
  );

  return (
    <section className="mcp-page">
      <header className="mcp-header">
        <div className="mcp-heading">
          <h1>MCP Servers</h1>
          <p>
            Add and connect Model Context Protocol servers. Select a server with{' '}
            <code>/mcp</code> in chat when you want Mocu to use its tools for one
            request. MCP access is never granted to agents automatically.
            Importing a server never runs anything: connecting a stdio server starts a
            local process and always asks for approval first.
          </p>
        </div>

        <div className="mcp-header-actions">
          <button
            type="button"
            className="mcp-button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
          <button
            type="button"
            className="mcp-button"
            onClick={() => {
              setImportWarnings([]);
              setShowImport(true);
            }}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="mcp-button mcp-button--primary"
            onClick={openAdd}
          >
            Add Server
          </button>
        </div>
      </header>

      {pageError && <pre className="mcp-error">{pageError}</pre>}
      {loading && <p className="mcp-status">Loading MCP servers…</p>}

      {!loading && sortedServers.length === 0 && (
        <p className="mcp-empty">
          No MCP servers configured yet. Import an mcpServers JSON document or add a
          server manually.
        </p>
      )}

      <div className="mcp-grid">
        {sortedServers.map((summary) => {
          const { config } = summary;
          const busy = busyIds.has(config.id);
          const tools = toolCache[config.id] ?? [];

          return (
            <article key={config.id} className="mcp-card">
              <header className="mcp-card-header">
                <h3>
                  <span className={`mcp-status-dot mcp-status-dot--${summary.status}`} />
                  {config.name}
                </h3>

                <div className="mcp-card-badges">
                  <span className="mcp-badge">{config.transport}</span>
                  {!config.enabled && (
                    <span className="mcp-badge mcp-badge--disabled">disabled</span>
                  )}
                </div>
              </header>

              <p className="mcp-card-description">
                {config.transport === 'stdio'
                  ? `${config.command} ${(config.args ?? []).join(' ')}`
                  : config.url}
              </p>

              <div className="mcp-card-meta">
                <span>
                  {summary.status === 'connected'
                    ? `${summary.toolCount} tool${summary.toolCount === 1 ? '' : 's'}`
                    : summary.status}
                </span>
                <span>
                  tools {summary.capabilities.tools ? '✓' : '—'} · resources{' '}
                  {summary.capabilities.resources ? '✓' : '—'} · prompts{' '}
                  {summary.capabilities.prompts ? '✓' : '—'}
                </span>
              </div>

              {summary.error && <pre className="mcp-error">{summary.error}</pre>}

              {config.notes && config.notes.length > 0 && (
                <pre className="mcp-card-notes">{config.notes.join('\n')}</pre>
              )}

              <div className="mcp-card-actions">
                {summary.status !== 'connected' ? (
                  <button
                    type="button"
                    className="mcp-button mcp-button--small mcp-button--primary"
                    disabled={busy || !config.enabled}
                    onClick={() => void handleTest(summary)}
                  >
                    {busy ? 'Connecting…' : summary.status === 'error' ? 'Retry' : 'Connect'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mcp-button mcp-button--small"
                    disabled={busy}
                    onClick={() => void handleDisconnect(summary)}
                  >
                    Disconnect
                  </button>
                )}

                <button
                  type="button"
                  className="mcp-button mcp-button--small"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(summary)}
                >
                  {config.enabled ? 'Disable' : 'Enable'}
                </button>

                <button
                  type="button"
                  className="mcp-button mcp-button--small"
                  disabled={busy}
                  onClick={() => openEdit(summary)}
                >
                  Edit
                </button>

                <button
                  type="button"
                  className="mcp-button mcp-button--small"
                  disabled={busy}
                  onClick={() => void handleLoadDiagnostics(summary)}
                >
                  Diagnostics
                </button>

                <button
                  type="button"
                  className="mcp-button mcp-button--small mcp-button--danger"
                  disabled={busy}
                  onClick={() => void handleRemove(summary)}
                >
                  Remove
                </button>
              </div>

              {diagnostics[config.id]?.length > 0 && (
                <pre className="mcp-diagnostics">
                  {diagnostics[config.id].join('\n')}
                </pre>
              )}

              {summary.status === 'connected' && (
                <div className="mcp-tools">
                  <button
                    type="button"
                    className="mcp-button mcp-button--small"
                    onClick={() => void handleToggleTools(summary)}
                  >
                    {expandedTools.has(config.id)
                      ? 'Hide tools'
                      : `Show tools${summary.toolCount > 0 ? ` (${summary.toolCount})` : ''}`}
                  </button>

                  {expandedTools.has(config.id) && (
                    (toolCache[config.id] ?? []).length === 0 ? (
                      <button
                        type="button"
                        className="mcp-button mcp-button--small"
                        onClick={() => void handleLoadTools(summary)}
                      >
                        Load tool list
                      </button>
                    ) : (
                      tools.map((mcpTool) => (
                        <div key={mcpTool.name} className="mcp-tool-row">
                          <div className="mcp-tool-row-top">
                            <span className="mcp-tool-name">{mcpTool.name}</span>
                            <span className="mcp-tool-availability">
                              Available in chat with <code>/mcp</code>
                            </span>
                          </div>
                          {mcpTool.description && (
                            <span className="mcp-tool-description">
                              {mcpTool.description}
                            </span>
                          )}
                        </div>
                      ))
                    )
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="mcp-modal-backdrop">
          <div className="mcp-modal">
            <h2>Import MCP servers</h2>
            <div className="mcp-field">
              <label htmlFor="mcp-import">mcpServers JSON</label>
              <textarea
                id="mcp-import"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={`{\n  "mcpServers": {\n    "chrome-devtools": {\n      "command": "npx",\n      "args": ["-y", "chrome-devtools-mcp@latest"]\n    },\n    "remote-tools": {\n      "transport": "streamable-http",\n      "url": "https://example.com/mcp"\n    }\n  }\n}`}
              />
              <span className="mcp-field-hint">
                Accepted transports: stdio, streamable-http, sse. Secret fields
                (env/headers) are stored in the secrets store. Importing never
                executes anything.
              </span>
            </div>

            {importWarnings.length > 0 && (
              <pre className="mcp-card-notes">{importWarnings.join('\n')}</pre>
            )}

            <div className="mcp-modal-actions">
              <button
                type="button"
                className="mcp-button"
                onClick={() => setShowImport(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="mcp-button mcp-button--primary"
                disabled={!importText.trim()}
                onClick={() => void withBusy('__import__', handleImport).catch(() => undefined)}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit modal */}
      {editorTarget && (
        <div className="mcp-modal-backdrop">
          <div className="mcp-modal">
            <h2>
              {editorTarget.mode === 'add' ? 'Add MCP server' : `Edit ${editorTarget.serverId}`}
            </h2>

            <div className="mcp-field-row">
              <div className="mcp-field">
                <label htmlFor="mcp-id">Server ID</label>
                <input
                  id="mcp-id"
                  value={form.id}
                  disabled={editorTarget.mode === 'edit'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                  placeholder="chrome-devtools"
                />
              </div>

              <div className="mcp-field">
                <label htmlFor="mcp-name">Display name</label>
                <input
                  id="mcp-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
            </div>

            <div className="mcp-field-row">
              <div className="mcp-field">
                <label htmlFor="mcp-transport">Transport</label>
                <select
                  id="mcp-transport"
                  value={form.transport}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      transport: event.target.value as FormState['transport'],
                    }))
                  }
                >
                  <option value="streamable-http">Streamable HTTP</option>
                  <option value="sse">Legacy HTTP+SSE</option>
                  <option value="stdio">stdio (local command)</option>
                </select>
              </div>

              <label className="mcp-check">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                Enabled
              </label>
            </div>

            {form.transport === 'stdio' ? (
              <>
                <div className="mcp-field">
                  <label htmlFor="mcp-command">Command</label>
                  <input
                    id="mcp-command"
                    value={form.command}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, command: event.target.value }))
                    }
                    placeholder="npx"
                  />
                  <span className="mcp-field-hint">
                    Executed with its arguments as a structured process — never a shell
                    string. node/npx require Node.js; uvx requires uv; docker requires a
                    running daemon. First starts may download packages.
                  </span>
                </div>

                <div className="mcp-field">
                  <label htmlFor="mcp-args">Arguments (one per line)</label>
                  <textarea
                    id="mcp-args"
                    value={form.args}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, args: event.target.value }))
                    }
                    placeholder={'-y\nchrome-devtools-mcp@latest'}
                  />
                </div>

                <div className="mcp-field">
                  <label htmlFor="mcp-cwd">Working directory (optional)</label>
                  <input
                    id="mcp-cwd"
                    value={form.cwd}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, cwd: event.target.value }))
                    }
                  />
                </div>

                <div className="mcp-field">
                  <label htmlFor="mcp-env">Environment variables (JSON, secret)</label>
                  <textarea
                    id="mcp-env"
                    value={form.env}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, env: event.target.value }))
                    }
                    placeholder={'{\n  "API_KEY": "..."\n}'}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="mcp-field">
                  <label htmlFor="mcp-url">URL</label>
                  <input
                    id="mcp-url"
                    value={form.url}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, url: event.target.value }))
                    }
                    placeholder="https://example.com/mcp"
                  />
                </div>

                <label className="mcp-check">
                  <input
                    type="checkbox"
                    checked={form.allowInsecureHttp}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        allowInsecureHttp: event.target.checked,
                      }))
                    }
                  />
                  Allow plain HTTP for non-local endpoints (explicit risk override)
                </label>

                <div className="mcp-field-row">
                  <div className="mcp-field">
                    <label htmlFor="mcp-auth">Authentication</label>
                    <select
                      id="mcp-auth"
                      value={form.authType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          authType: event.target.value as FormState['authType'],
                        }))
                      }
                    >
                      <option value="none">None</option>
                      <option value="bearer">Bearer token</option>
                      <option value="headers">Custom headers</option>
                    </select>
                  </div>

                  {form.authType === 'bearer' && (
                    <div className="mcp-field">
                      <label htmlFor="mcp-bearer">Bearer token (secret)</label>
                      <input
                        id="mcp-bearer"
                        type="password"
                        value={form.bearerToken}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            bearerToken: event.target.value,
                          }))
                        }
                      />
                    </div>
                  )}
                </div>

                {form.authType === 'headers' && (
                  <div className="mcp-field">
                    <label htmlFor="mcp-headers">Headers (JSON, secret)</label>
                    <textarea
                      id="mcp-headers"
                      value={form.headers}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          headers: event.target.value,
                        }))
                      }
                      placeholder={'{\n  "X-Api-Key": "..."\n}'}
                    />
                  </div>
                )}
              </>
            )}

            <div className="mcp-field-row">
              <div className="mcp-field">
                <label htmlFor="mcp-timeout">Request timeout (seconds)</label>
                <input
                  id="mcp-timeout"
                  type="number"
                  min="1"
                  value={form.timeoutSeconds}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      timeoutSeconds: event.target.value,
                    }))
                  }
                  placeholder="60"
                />
              </div>

              <div className="mcp-field">
                <label htmlFor="mcp-connect-timeout">Connect timeout (seconds)</label>
                <input
                  id="mcp-connect-timeout"
                  type="number"
                  min="1"
                  value={form.connectTimeoutSeconds}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      connectTimeoutSeconds: event.target.value,
                    }))
                  }
                  placeholder="60"
                />
              </div>
            </div>

            <div className="mcp-modal-actions">
              <button
                type="button"
                className="mcp-button"
                onClick={() => setEditorTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mcp-button mcp-button--primary"
                disabled={!form.id.trim()}
                onClick={() => void withBusy('__form__', handleSaveForm).catch(() => undefined)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}
