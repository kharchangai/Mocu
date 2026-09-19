# MCP (Model Context Protocol) in Mocu

Mocu is an **MCP host**: it connects to external MCP servers, discovers their
tools, and lets its agents call those tools through the normal Mocu tool
pipeline (the same `ToolExecutor` used by native tools and extensions).

## Transports

| Transport | Config value | Use |
| --- | --- | --- |
| stdio | `"stdio"` | Local server process started from a configured executable (`node`, `npx`, `python`, `uvx`, `docker`, …). |
| Streamable HTTP | `"streamable-http"` | Current HTTP transport for local or remote endpoints. |
| Legacy HTTP+SSE | `"sse"` | Compatibility with older MCP servers. Select explicitly. |

WebSocket or other proprietary endpoints are **not** supported transports.

## Import format

Open the sidebar → **MCP** → *Import JSON*. Mocu accepts the common
`mcpServers` document format (or a bare record of server entries):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--slim", "--headless"]
    }
  }
}
```

Remote example (Mocu's documented format):

```json
{
  "mcpServers": {
    "remote-tools": {
      "transport": "streamable-http",
      "url": "https://example.com/mcp"
    },
    "legacy-tools": {
      "transport": "sse",
      "url": "https://example.com/sse"
    }
  }
}
```

### Accepted fields per server

| Field | Applies to | Meaning |
| --- | --- | --- |
| `id` | all | Stable server id (defaults to the record key, sanitized). |
| `name` | all | Display name (defaults to the record key). |
| `transport` | all | `stdio`, `streamable-http`, or `sse` (`type` is accepted as an alias; `http` maps to `streamable-http`). |
| `enabled` | all | Enable/disable without deleting (default `true`). |
| `command`, `args`, `cwd` | stdio | Executable, arguments (preserved verbatim), working directory. |
| `url` | remote | Server endpoint (http/https only). |
| `allowInsecureHttp` | remote | Explicit override to allow plain HTTP to non-local endpoints. |
| `auth` | remote | `none`, `bearer`, or `headers`. OAuth is not supported in this version. |
| `timeoutSeconds` | all | Per-request timeout (default 60 s, max 86400). |
| `connectTimeoutSeconds` | all | Connection/initialization timeout (default 60 s). |
| `env`, `headers` | all | Secret values. Stored in the secrets store, never in the server configuration. |

Unknown fields are reported in per-server notes, never silently dropped.
Invalid combinations (stdio + url, remote + command, non-http URL schemes,
plain HTTP to non-local endpoints without the explicit override) are rejected.

**Importing or saving configuration never executes third-party code.**

## Approval model for stdio servers

Connecting a stdio server starts a local third-party process. Mocu requires
explicit approval:

- Before the **first** connection, and
- after any change to the launch configuration (command, args, cwd, env).

The approval is a fingerprint of the launch configuration. Beware of mutable
package references such as `@latest`: the executed code can change without
notice. Node.js/npm (`npx`), uv (`uvx`), or Docker must be installed on the
machine; the first start may need extra time to download packages. Mocu never
performs a global install and never silently installs system software.

Child processes inherit only a minimal safe environment; user-configured
`env` values are applied on top. stdout is reserved for MCP messages; stderr
is captured (bounded) as diagnostics with configured secrets redacted.

## Using MCP tools from chat

- Add and connect a server from the **MCP** page, then type `/mcp` in chat
  and select the server. Only servers selected this way are visible to the
  model for that request, like an `/extension` selection.
- Selecting a server does **not** bind every tool of the server into the
  prompt. The model receives only the server's name and description, plus two
  gateway tools:
  - `mcp_list_tools` — called with the MCP server name; returns every tool the
    server exposes (names, descriptions, argument schemas).
  - `mcp_call_tool` — called with the server name, a tool name, and a JSON
    arguments object; executes that one tool.
- The intended model flow: list the MCP tools first, then call the tool that
  fits the job. Gateway tools reject servers that were not selected for the
  current request, and the trusted execution layer re-checks the
  server/tool pair on every call.
- Connecting or discovering a server never makes its tools visible to the
  model. A request that does not select `/mcp` cannot call MCP tools.
- MCP tools are not assigned to saved agents. If a request explicitly selects
  both `/agent <name>` and `/mcp <server>`, the selected server is available to
  that delegated run for that request only.

## Resources and prompts

When a server negotiates the capabilities, Mocu can list/read resources and
list prompts (connection test connects and lists capabilities without
invoking any tool). Sampling, elicitation, and roots are intentionally not
advertised by Mocu's client; servers requesting them receive a clear
method-not-found error instead of fabricated success.

## Manual integration test (approved example)

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--slim", "--headless"]
    }
  }
}
```

Prerequisites: Node.js ≥ 18 / npm on PATH. Import the document, press
**Connect**, approve the execution, and verify the tool list appears. Report
incompatible package flags instead of rewriting the configuration.
