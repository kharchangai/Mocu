---
id: mocu-mcp
title: Mocu MCP Servers
description: Explains Mocu's MCP (Model Context Protocol) host support,
  including connecting external servers, importing the common `mcpServers` JSON
  format, and using MCP tools in chats. Retrieve it when a user asks about MCP,
  connecting an MCP server, or using MCP tools.
keywords:
  - Mocu MCP
  - MCP server
  - MCP servers
  - Model Context Protocol
  - MCP page
  - connect MCP server
  - mcpServers JSON
  - stdio transport
  - Streamable HTTP
  - SSE transport
  - /mcp command
  - MCP tools
  - pinned MCP servers
  - import MCP servers
---
# Mocu MCP Servers

## What MCP support does

Mocu is an **MCP host**: it can connect to external **MCP servers** (Model Context Protocol) and expose their tools to Mocu's agents through the same tool pipeline as native tools. This lets you plug in ecosystems of external tools (file servers, databases, web tools, custom servers) without writing a Mocu extension.

## Supported transports

- **stdio** — the server runs as a local child process communicating over stdin/stdout (the Rust backend spawns and bridges it).
- **Streamable HTTP** — a remote server over HTTP with streaming.
- **SSE** — the legacy HTTP + Server-Sent Events transport.

## The MCP page

The **MCP** page (sidebar) lets you:

- **Add a server** with a form (name, transport, command/URL, arguments, environment variables, headers).
- **Import servers** by pasting a document in the common `mcpServers` JSON format (the same format used by other MCP clients).
- **Connect / disconnect** servers, **enable or disable** them, and **pin** servers so they auto-connect for chats.
- **Delete** a server.

## Using MCP tools in chat

- Type **`/mcp`** in the chat input to open the list of connected MCP servers and select one for the current request.
- Or ask in plain language — "use the filesystem MCP server to list my downloads".

Like extensions, MCP servers are **opt-in per request**: only the servers you select contribute tools. MCP tool descriptions and results are external content and can never override system instructions or security rules.

## MCP vs Extensions

| | MCP servers | Extensions |
|---|---|---|
| What | External tool servers via the MCP standard | Mocu-native Node/Python add-ons via JSON-RPC |
| Best for | Standard tool ecosystems, remote servers | Deep Mocu integration (LLM callbacks, Jev, streaming UI, config forms) |
| Transport | stdio, Streamable HTTP, SSE | child process, stdio JSON-RPC |

Both expose tools to agents the same way — pick whichever fits the tool you want to add. See [Mocu Extensions](mocu-extensions.md).

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Chat, Slash Commands, Focus and Step-by-Step](mocu-chat-commands.md) — the `/mcp` command
- [Mocu Extensions](mocu-extensions.md) — the extension system
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — how tools are invoked

## When to use this document

Retrieve it when the user asks about MCP, connecting an MCP server, the MCP page, the `mcpServers` JSON format, transports, pinned servers, the `/mcp` command, or using MCP tools in Mocu.
