---
id: mocu-extension-development
title: Mocu Extension Development
description: Explains Mocu extension architecture, global resource folders,
  active manifest requirements, SDK usage, installation, and packaging
  constraints. Retrieve when building, distributing, installing, or
  troubleshooting a Mocu extension or locating its SDK and bundled defaults.
keywords:
  - Mocu extension
  - extension development
  - extension SDK
  - Node extension
  - Python extension
  - manifest.json
  - JSON-RPC stdin stdout
  - child process
  - SDK local vendoring
  - npm E404
  - MOCU GLOBAL DIRECTORY
  - appDataDir
  - extensions-default
  - global app-data
  - اکستنشن
---
# Mocu Extension Development

## Architecture and source of truth

A Mocu extension is a separate **Node.js or Python child process**, not a browser plug-in. Mocu starts it on demand when an extension command is invoked.

The active implementation and resource locations are:

- Runtime: `src/extensions` and `src-tauri/src/extension_host`
- SDK source in a development checkout: `install-resources/extension-system/sdk-node` and `install-resources/extension-system/sdk-python`; shared JSON-RPC contracts: `install-resources/extension-system/contracts`
- Bundled extension defaults in a development checkout: `install-resources/extensions-default`
- Installed global resource folders: `<resolved Mocu app-data directory>/extension-system` and `<resolved Mocu app-data directory>/extensions-default`
- Installed user extensions: `<resolved Mocu app-data directory>/extensions/<sanitized extension id>`
- Real examples: `extensions-examples` at the repository root, notably `hi-llm-node`, `sysinfo-node`, `filesystem`, `youtube`, `telegram`, and `pi-node`

Use the active runtime scanner, SDK source, and examples as the source of truth. Verify runtime and API details in the corresponding files instead of guessing.

## Resolving the global app-data directory

At runtime, the agent receives the current user-specific, absolute Mocu global application-data directory in the **MOCU GLOBAL DIRECTORY** context. When inspecting files with filesystem tools, use that exact injected path as the root and append the relevant folder name using path joining. Never hard-code a username, OS-specific location, or another guessed absolute path.

If the MOCU GLOBAL DIRECTORY context is unavailable to code running inside the Tauri app, resolve the root using Tauri `appDataDir()` or `BaseDirectory.AppData` for Tauri filesystem APIs.

Do not invent an environment variable for this path. The host currently sets only `MOCU_EXTENSION_ID` and `MOCU_EXTENSION_ROOT` for extension child processes; it does not expose the global app-data directory through an environment variable.

In a development checkout, the corresponding bundled source folders are under `install-resources/extension-system` and `install-resources/extensions-default`. These repository paths are development sources, **not** the installed-user global location.

## Global extension resource folders

Mocu initializes and copies bundled resource folders into its global app-data directory on first launch. The relevant folders are:

- **`extension-system`** contains the Node SDK (`sdk-node`), Python SDK (`sdk-python`), and shared protocol/contracts package (`contracts`). When developing or building in an installed app, use this folder as the SDK source.
- **`extensions-default`** contains Mocu-shipped bundled extension examples and installable defaults. Each extension is in its own child folder, with `manifest.json` at that child folder’s root. Inspect the manifest and source before relying on an extension’s capabilities.
- **`extensions`** contains user-installed copies, stored under `extensions/<sanitized extension id>`. It is not the bundled-default catalog.

Treat folders in `extensions-default` as sources to browse or install, not as places for user-specific edits. Install an extension through Mocu or work on a separate copy.

For packaged extensions, use the global `extension-system` folder only as a build-time source. Copy or vendor the SDK packages an extension needs into the extension itself. An installed extension must never depend on an SDK or other file at an external global app-data path.

## Process and protocol requirements

The host communicates with the extension process using newline-delimited JSON-RPC:

- Requests are written to the process’s **stdin**.
- JSON-RPC responses are read from **stdout**.
- Keep stdout exclusively for protocol traffic. Send logs to stderr: use `console.error` in Node.js and `sys.stderr` in Python. Logging to stdout can corrupt the protocol.
- The process current working directory is the extension root.
- The host sets `MOCU_EXTENSION_ID` and `MOCU_EXTENSION_ROOT`.

Host commands are:

- Node.js: `node <entry>`
- Python on Windows: `python -u <entry>`
- Python on other platforms: `python3 -u <entry>`

## Active manifest requirements

The active extension scanner requires non-empty values for:

- `id`
- `name`
- `description`
- `version`
- `entry`
- `runtime`, set to `node` or `python`

It also supports optional `permissions`, optional `commands`, and an optional UI `config` array. The active manifest shape does **not** require `manifestVersion`.

Keep the extension ID stable and unique. A reverse-domain ID such as `com.example.hello` is a safe convention. Each implemented command key must match a command ID declared in the manifest.

### Do not confuse the contracts validator with the active manifest

The separate `extension-system/contracts` module has a validator that expects `manifestVersion: 1` and a different `configuration` object schema. That validator-only shape is not the active app runtime’s manifest shape. Do not copy it into an extension intended for the active app. Follow the active scanner types and working examples instead.

## Minimal Node.js extension

A minimal Node project’s development structure contains:

- `manifest.json`
- `package.json`
- `index.js`

The SDK source is in `extension-system/sdk-node`. An API/development example can use `"type": "module"` and declare `"@mocu/extension-sdk": "0.1.0"` as a dependency:

```js
import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    async hello(input, context, config) {
      return { message: "Hello from Mocu", received: input };
    },
  },
});

extension.start();
```

The `hello` command key must match a `commands[].id` declared in `manifest.json`. Mocu sends `extension.execute` with `{command,input,context,config}`. The SDK dispatches the command, awaits the Node handler, and responds with `{success:true,output}` or `{success:false,error}`. Return a JSON-serializable value.

### Node SDK distribution and packaging

The registry dependency shown above describes SDK usage for development; it is **not** a reliable public-distribution recipe. As of **2026-10-05**, `npm view @mocu/extension-sdk@0.1.0 version` returned E404. The package is not currently available from public npm; E404 may mean it is unpublished or access-restricted. Repository examples that use a bare version such as `"@mocu/extension-sdk": "0.1.0"` should not be treated as evidence that public npm installation will work. Do not use that bare registry dependency in a distributable extension.

The Mocu installer runs npm in the extracted extension directory, not in Mocu's global resource directory. A distributable ZIP must therefore include a self-contained local copy of the SDK and its `@mocu/extension-contracts` runtime dependency. Use the installed global source at `<resolved Mocu app-data directory>/extension-system/` (or the corresponding `install-resources/extension-system/` directory in a development checkout) as the build-time source, then copy the packages into the extension before creating the ZIP:

1. For Node.js, copy `sdk-node/package.json` and `sdk-node/dist/` into `vendor/extension-sdk/`; copy `contracts/package.json` and `contracts/dist/` into `vendor/extension-contracts/`.
2. Set the extension root dependency to `"@mocu/extension-sdk": "file:./vendor/extension-sdk"` and make the SDK's contracts dependency resolve to the local `../extension-contracts` package. No dependency path may escape the extension folder.
3. Exclude `node_modules`; the installer creates it by running npm install.
4. Verify `npm install` from a clean staged copy, then test the installed ZIP in Mocu.

For the verified self-contained layout and clean staging test, see [SDK Local Vendoring and Packaging](mocu-extension-sdk-local-vendoring-and-packaging.md).

## Minimal Python extension

The Python SDK source is `extension-system/sdk-python/mocu_extension_sdk`. Import `create_extension` and register a synchronous handler:

```python
from mocu_extension_sdk import create_extension

extension = create_extension()

@extension.command("hello")
def hello(input, context, config):
    return {"message": "Hello from Mocu", "received": input}

extension.run()
```

The command ID, here `hello`, must match a command ID declared in the manifest. Python SDK handlers are synchronous in the current implementation: use `def`, not `async def`. The current Python execute dispatcher does not await returned awaitables.

The Python SDK is available in the installed global resource folder at `<resolved Mocu app-data directory>/extension-system/sdk-python/` (in a development checkout, use `install-resources/extension-system/sdk-python/`). Mocu does not run pip during extension installation and the SDK should not be assumed to be on PyPI. For a portable Python extension, copy the `mocu_extension_sdk/` package from that SDK directory into the extension, for example under `vendor/mocu_extension_sdk/`, and ensure the extension's import path includes `vendor/` (or install that local package into its environment). Do not make a packaged extension depend on Mocu's external app-data path.

For local development from the repository root, you can still install the SDK with:

```bash
python -m pip install -e install-resources/extension-system/sdk-python
```

## Install and run an extension

From Mocu’s Extensions page, install an extension from a folder or ZIP:

- A folder must contain `manifest.json` at its root.
- A ZIP must contain the manifest at the archive root or inside one top-level folder.
- The install destination is app data at `extensions/<sanitized manifest id>`.
- Folder copying excludes `node_modules`.
- If `package.json` exists, the installer runs `npm install --no-audit --no-fund`.
- This npm installation path does not automatically install Python packages. Ensure Python and any required SDK or dependencies are available to the host interpreter.

Bundled defaults in `extensions-default` are sources to browse or install; installed copies belong under `extensions/<sanitized extension id>`. After installation, select or enable the extension for a chat request and invoke its command. Extensions are **opt-in**; installing one alone does not make it active for a chat request.

For more detail, see [Runtime and installation](mocu-extension-runtime.md) and [SDK API reference](mocu-extension-sdk-reference.md).

## Practical creation checklist

1. Choose a globally unique, stable extension ID and stable command IDs.
2. Write `manifest.json` using the active manifest requirements and examples.
3. Add the appropriate SDK and entry point for Node.js or Python.
4. For a distributable Node extension, vendor the SDK and contracts dependency locally; verify npm installation from a clean staged copy. For Python, include the SDK locally or document a tested prerequisite.
5. Implement every command declared in the manifest, matching each manifest command ID to its handler.
6. Keep stdout reserved for JSON-RPC protocol messages; write logs to stderr.
7. Install using **Install from Folder** and test the extension.
8. Select or enable it for a chat request, invoke its command, inspect errors, and refine the implementation.

## When to use this document

Retrieve this document when an agent needs to build, package, distribute, install, or debug a Mocu extension; choose between the Node and Python SDKs; understand `manifest.json`, JSON-RPC, child-process behavior, or installation requirements; or resolve SDK availability, npm E404, and local-vendoring questions. Also use it to locate global Mocu resource folders safely, inspect bundled defaults, distinguish bundled sources from user-installed extensions, or determine the correct app-data path without guessing. It is relevant to searches such as اکستنشن or ساخت اکستنشن.
