# Mocu Extension System — Documentation

This folder documents how to build, install and run **Mocu extensions**. It is
written for both **humans** and **AI agents**: every file has a *Search
keywords* section so any topic can be found with grep / full-text search.

Start here if you are new. If you are an AI agent asked to "create an
extension for Mocu", read [agent-guide.md](agent-guide.md) first.

## Document map

| File | Subjects covered |
|------|------------------|
| [architecture.md](architecture.md) | What an extension is, host ↔ extension process model, lazy activation, lifecycle, supported runtimes, JSON-RPC over stdin/stdout |
| [manifest-reference.md](manifest-reference.md) | `manifest.json` fields, commands, `streaming`, `timeoutSeconds`, validation rules, common validation errors |
| [node-sdk.md](node-sdk.md) | Building a Node.js extension with `@mocu/extension-sdk`, `createExtension`, command handlers, `package.json`, stdout rules |
| [python-sdk.md](python-sdk.md) | Building a Python extension with `mocu_extension_sdk`, `@command` decorator, `run()`, pyproject.toml |
| [llm-calls.md](llm-calls.md) | Calling the Mocu host LLM from an extension: `extension.llm.generate`, prompt / systemPrompt / temperature / maxTokens |
| [streaming-activity.md](streaming-activity.md) | Live progress streaming to the chat: `mocu.extension.activity`, `extension.notify`, `streaming: true`, `context.toolCallId` |
| [installation.md](installation.md) | Packaging an extension as a ZIP, install location (`appDataDir/extensions`), auto `npm install`, uninstall, discovery/scanning |
| [protocol-reference.md](protocol-reference.md) | Wire protocol: JSON-RPC 2.0 messages, `extension.execute`, result shape, host methods, error handling |
| [examples.md](examples.md) | Catalog of the examples in `extensions-examples/`, recipes, troubleshooting / FAQ |
| [agent-guide.md](agent-guide.md) | Step-by-step workflow for an AI agent creating an extension for a user, checklists, decision guide |

## Quick start (30 seconds)

An extension is a **folder** with:

1. `manifest.json` — declares id, name, runtime, entry file and commands.
2. An entry file (`index.js` for Node, `main.py` for Python) that registers
   command handlers and talks JSON-RPC over stdin/stdout (the SDK does this
   for you).

Minimal Node extension:

```js
// index.js
import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    hello(input) {
      return `Hello, ${input?.name ?? "world"}!`;
    },
  },
});

extension.start();
```

```json
// manifest.json
{
  "id": "com.example.hello",
  "name": "Hello Extension",
  "description": "Says hello.",
  "version": "1.0.0",
  "runtime": "node",
  "entry": "index.js",
  "commands": [
    { "id": "hello", "title": "Say hello", "description": "Greets the caller." }
  ]
}
```

Zip the folder (with `manifest.json` inside) and install it from Mocu's
Extensions page — see [installation.md](installation.md).

## Source of truth (code references)

| Topic | Code |
|-------|------|
| Shared contracts (manifest, protocol, LLM types) | `extension-system/contracts/src/` |
| Node SDK | `extension-system/sdk-node/src/` |
| Python SDK | `extension-system/sdk-python/mocu_extension_sdk/` |
| Host (Rust) process manager | `src-tauri/src/extension_host/` |
| Frontend scanner / installer / agent tools | `src/extensions/services/` |
| Examples | `extensions-examples/` |
