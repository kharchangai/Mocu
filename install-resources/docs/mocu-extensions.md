---
id: mocu-extensions
title: Mocu Extensions
description: Explains what Mocu extensions do and how end users install, select,
  configure, and use them. Retrieve it for questions about extension
  installation, per-request tool access, or settings in Mocu.
keywords:
  - Mocu extensions
  - extension
  - extensions page
  - install extension
  - install from folder
  - install from ZIP
  - bundled extensions
  - select extension
  - extension tools
  - /extension command
  - enable extension
  - extension config
  - extension settings
  - Node extension
  - Python extension
---
# Mocu Extensions

## What an extension is

An **extension** is an independent **Node.js or Python** program that adds callable tools to Mocu's agents. Extensions communicate with Mocu over JSON-RPC 2.0 using stdin and stdout. Each command an extension exposes becomes an agent tool.

Examples of bundled extensions include `filesystem`, `ssh`, `telegram`, `youtube`, `plan-code-runner`, `pi-node`, and `hi-llm-node`.

Extensions are started lazily, only when one of their commands runs. An extension can call Mocu's LLM, Jev decision model, and embedding model, and can stream live progress into the chat. Current metadata is passed to extensions when they run; the specific metadata fields are not listed here.

## The Extensions page

The **Extensions** page in the sidebar lets users:

- View bundled extensions shipped with Mocu and install them with one click.
- Install from a folder by selecting a folder containing a `manifest.json`.
- Install from a ZIP by selecting a `.zip` archive of an extension.
- Select an extension for chat requests.
- Configure an extension using the settings fields defined in its manifest.
- Uninstall an extension.

Extensions are installed under Mocu's app-data folder at `extensions/<sanitized id>`.

For dependencies:

- Mocu automatically runs `npm install` for Node extensions.
- Python extensions manage their own dependencies; Mocu does not automatically run `pip`.

## Selecting and using extensions in chat

Installing an extension does **not** activate it. Extensions are opt-in: only extensions explicitly selected for a request are exposed to the agent as tools. An empty selection means no extension tools are available.

To select an extension for the current request, type **`/extension`** in the chat input and choose from the installed extensions. You can also request one in plain language, such as “use the telegram extension to send this.”

Tool names are generated from the extension ID and command ID.

## Extension configuration

If an extension's manifest defines configuration fields, such as an API key, a settings form appears on the Extensions page. Enter values there; Mocu passes them to the extension process when it runs. Current metadata is also passed to extensions, but its specific fields are not documented here.

## Developer documentation

Detailed developer documentation covering the architecture, manifest reference, Node and Python SDKs, protocol reference, and an AI-agent authoring guide lives in the repository under `docs/extention/`. Focused guides also ship inside the app in the docs folder:

- [Mocu Extension Docs Map](mocu-extension-docs-map.md) — choose the right guide
- [Mocu Extension Development](mocu-extension-development.md) — build an extension
- [Mocu Extension Runtime](mocu-extension-runtime.md) — manifest, installation, lifecycle
- [Mocu Extension SDK Reference](mocu-extension-sdk-reference.md) — SDK APIs
- [Mocu Extension SDK Local Vendoring and Packaging](mocu-extension-sdk-local-vendoring-and-packaging.md) — packaging for distribution

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Chat, Slash Commands, Focus and Step-by-Step](mocu-chat-commands.md) — the `/extension` command
- [Mocu MCP Servers](mocu-mcp.md) — another way to add external tools
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — how tools are invoked
- [Mocu Extension Docs Map](mocu-extension-docs-map.md) — extension developer guides

## When to use this document

Retrieve this document when a user asks what Mocu extensions are, how to install one from a ZIP or folder, what the Extensions page does, how to select an extension for a chat request, whether installation activates an extension, how to configure or uninstall one, or how extension tools become available in chat.
