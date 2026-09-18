# Architecture — How Mocu Extensions Work

**Search keywords:** extension architecture, host, runtime, node, python,
lazy activation, spawn, process, lifecycle, stdin, stdout, JSON-RPC,
on demand, extension.execute, extension manager, registry, lazy spawn,
how extensions run, process model, keep alive

## What is a Mocu extension?

A Mocu extension is an **independent program** (a Node.js or Python script)
that runs as a **separate OS process** and communicates with the Mocu host
over **JSON-RPC 2.0 via stdin/stdout** (newline-delimited JSON messages).

An extension exposes one or more **commands**. There is no manual
activate/deactivate or initialize stage — Mocu simply calls a command on
demand and the extension returns a result.

## The three parts

1. **The host (Rust, Tauri)** — `src-tauri/src/extension_host/`
   - Keeps a registry of installed extensions (read from `manifest.json`).
   - Spawns the extension process **lazily**, only when a command is run.
   - Routes `extension.execute` requests and resolves responses.
   - Enforces per-command timeouts (default **900 seconds**; `timeoutSeconds: 0`
     means no timeout; hard cap 24h).

2. **The SDK (Node or Python)** — `extension-system/sdk-node/`,
   `extension-system/sdk-python/`
   - Handles the JSON-RPC protocol over stdin/stdout for you.
   - Lets you register command handlers and call host APIs (the LLM).

3. **The frontend (TypeScript)** — `src/extensions/`
   - Scans the installed-extensions folder for `manifest.json` files.
   - Installs / uninstalls extensions (from ZIP files).
   - Exposes installed extension commands as **agent tools** so the AI can
     call them (tool names like `extension_pi_node_ask`).

## Lifecycle: lazy activation

Extensions are **never started by the user or the frontend explicitly**:

1. Mocu starts → nothing is spawned.
2. A user (or agent) triggers a command → the host **spawns the process on
   first use** (`node <entry>` or `python <entry>`).
3. The process **stays alive**; subsequent commands are routed to the same
   running process.
4. Re-registering the same extension at the same path is a no-op (keeps the
   process alive). Registering a *different path* for the same id **stops the
   old process** so the next call starts from the new files.
5. Long-running state (like a session) survives between commands, but there
   is no restart guarantee — extensions should tolerate being spawned fresh.

## Supported runtimes

| Runtime | Spawn command | SDK |
|---------|--------------|-----|
| `node`  | `node <entry>` | `@mocu/extension-sdk` (see [node-sdk.md](node-sdk.md)) |
| `python`| `python` (Windows) or `python3` (Unix) + `<entry>` | `mocu_extension_sdk` (see [python-sdk.md](python-sdk.md)) |

## Communication rules (critical)

- The extension process **stdout is the protocol channel**. Never
  `console.log()` / `print()` to stdout — it corrupts the JSON-RPC stream.
  Route logs to **stderr** instead.
- Messages are single-line JSON, newline-delimited.
- Requests from Mocu → `extension.execute`; requests from the extension →
  host methods such as `mocu.llm.generate`. See
  [protocol-reference.md](protocol-reference.md).

## Where extensions are installed

Installed extensions live under the app data directory,
`<appDataDir>/extensions/<extension-folder>/`. See
[installation.md](installation.md).

## Related documents

- Manifest format and validation: [manifest-reference.md](manifest-reference.md)
- Wire protocol details: [protocol-reference.md](protocol-reference.md)
- Streaming live progress: [streaming-activity.md](streaming-activity.md)
