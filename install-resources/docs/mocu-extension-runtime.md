---
id: mocu-extension-runtime
title: Mocu Extension Runtime
description: Explains the active Mocu extension manifest, commands,
  configuration, installation, selection, process lifecycle, and SDK dependency
  packaging caveats. Retrieve it when implementing, packaging, installing, or
  troubleshooting a Mocu extension and its tools or settings.
keywords:
  - manifest.json
  - commands
  - config
  - permissions
  - streaming
  - interactive
  - timeoutSeconds
  - Install from Folder
  - Install from ZIP
  - extension selection
  - /extension
  - lifecycle
  - SDK dependency installation
  - local SDK vendoring
  - extension packaging
---
# Mocu Extension Runtime

## Active manifest schema

The active frontend manifest schema is defined in `src/extensions/types/extension.ts`. The actual parser is `src/extensions/services/extension-scanner.ts`. Use the runtime shape below when creating an extension:

```json
{
  "id": "com.example.weather",
  "name": "Weather",
  "description": "Gets weather data",
  "version": "1.0.0",
  "runtime": "node",
  "entry": "index.js",
  "permissions": [],
  "commands": [
    {
      "id": "current",
      "title": "Current weather",
      "description": "Fetch current weather",
      "streaming": false,
      "interactive": false,
      "timeoutSeconds": 900
    }
  ],
  "config": [
    {
      "key": "apiKey",
      "label": "API key",
      "description": "Provider key",
      "type": "password",
      "required": true
    }
  ]
}
```

The current scanner requires `id`, `name`, `description`, `version`, and `entry` to be non-empty strings. `runtime` must be `node` or `python`. `entry` is relative to the extension root and should name an existing file; the host canonicalizes it and checks that it remains inside the extension root.

Use a stable, unique extension `id`; `version` should conventionally follow semver. The active scanner does not require `manifestVersion`.

### Do not confuse the separate contract validator

`extension-system/contracts/src/manifest.ts` validates a different formal shape that includes `manifestVersion: 1` and a `configuration` record. It is separate from the active runtime manifest. Do not substitute that contract shape for the active manifest or add `manifestVersion` or `configuration` on the assumption that the runtime requires them. The active user-settings field is `config`, an array.

## Commands and tool behavior

Each item in `commands[]` declares a command that the extension can handle:

- `id` is the runtime handler key.
- `title` and `description` provide UI and model context.
- `streaming: true` enables progress cards for `mocu.extension.activity` notifications.
- `interactive: true` is required before the extension can call the chat interaction API `mocu.extension.interact`.
- `timeoutSeconds` sets the command timeout. If omitted, the host default is 900 seconds. `0` means no timeout. Positive values are capped by the host at 24 hours.

A command is exposed as an extension tool only when its extension has been explicitly selected for the chat request. Tool names are generated in this form:

```text
extension_<sanitized extension id>_<sanitized command id>
```

Each tool accepts an optional argument shaped as `{ "input": string | object }`. No more than 24 command tools are exposed.

## Configuration

The active manifest uses `config`, an array of fields with this shape:

```json
{
  "key": "apiKey",
  "label": "API key",
  "description": "Provider key",
  "type": "password",
  "required": true,
  "default": "",
  "placeholder": "Enter your key"
}
```

For each field:

- `key` and `label` identify the setting.
- `description`, `type`, `required`, `default`, and `placeholder` are optional.
- Supported `type` values are `string`, `number`, `boolean`, and `password`.

The Extensions card renders the settings form, and password fields are masked. Settings are stored under `MOCU_EXTENSION_CONFIG`, keyed by extension ID. When a command runs, the host resolves saved values merged with field defaults and passes a config object as the handler’s third argument and as `params.config`. Required fields and numbers are validated when settings are saved. If there are no configuration fields, the config object is `{}`.

Treat credentials and other secrets as secrets: do not log them or commit them to source control.

## Installation and removal

The active UI supports **Install from Folder** and **Install from ZIP**.

- A folder installation requires `manifest.json` at the folder root.
- A ZIP must contain `manifest.json` at the archive root or inside one top-level folder. The installer rejects unsafe archive paths and strips a common top-level folder.
- Extensions are installed under app data at `extensions/<sanitized id>`.
- Installation fails if the destination already exists.
- Copying a folder omits `node_modules`. If the extension root contains `package.json`, Mocu runs `npm install --no-audit --no-fund`; if that install fails, the partial installation is removed.
- `npm install` does not install Python runtime dependencies. Ensure the required runtime—and any dependencies needed for it—is installed on the user’s machine.

Uninstalling stops the extension process and then removes the installation.

## SDK dependency installation and packaging caveats

Mocu's Node installer runs `npm install` inside the installed extension folder. It does not have access to Mocu's global resource directory or source repository, so an extension cannot rely on SDK dependencies being available there at runtime.

After first launch, SDK source packages are available at `<Mocu app-data directory>/extension-system/`: `sdk-node`, `sdk-python`, and shared `contracts`. Resolve the app-data directory for the current platform rather than hard-coding it. When preparing an extension, copy the needed SDK package(s) from this global folder into the extension's own directory before packaging/installing it.

The Node package `@mocu/extension-sdk@0.1.0` was checked against the public npm registry on 2026-10-05 and returned E404. Do not assume this SDK dependency can be fetched publicly. For a distributable Node extension:

- Copy `sdk-node/package.json` and `sdk-node/dist/` from the global `extension-system` folder into the extension, for example as `vendor/extension-sdk/`.
- Copy `contracts/package.json` and `contracts/dist/` alongside it as `vendor/extension-contracts/`.
- Use local `file:` dependencies that resolve only within the extension package; never reference the global SDK path from an installed extension.
- Include built `dist` files and manifests in the ZIP.
- Exclude `node_modules`; Mocu recreates it by running `npm install`.
- Validate installation from a clean staged copy before distributing the package.

For Python extensions, copy `sdk-python/mocu_extension_sdk/` from the same global folder into the extension, and make that local copy importable. The Python installer does not run `pip`; do not assume Python SDK dependencies are available on PyPI.

See [SDK Local Vendoring and Packaging](mocu-extension-sdk-local-vendoring-and-packaging.md) for the canonical packaging instructions, [Extension Development](mocu-extension-development.md) for creation steps, and [SDK API Reference](mocu-extension-sdk-reference.md) for API details.

## Selecting extensions for chat

`extension-agent-tools.ts` scans installed manifests, but installation alone does not make an extension available in every chat. Only IDs explicitly selected by the user for that request are exposed to the agent. An empty selection produces no extension tools.

Chat offers extensions via `/extension`. Missing selected IDs are reported. If a user expects an installed extension to be available but it is not selected, explain that they need to select or enable it for the request; do not claim installed extensions are automatically active.

## Process lifecycle and protocol

The Rust `ExtensionManager` lazily registers and spawns a child process on the first command call. It sends `extension.execute`, waits for the response, keeps the process alive between invocations, and handles timeouts. Users do not normally start or stop the process themselves. The corresponding Tauri command performs the blocking wait on a worker thread.

Communication over stdin and stdout uses newline-delimited JSON-RPC. Keep stdout exclusively for protocol messages; send diagnostic output elsewhere so it cannot corrupt the protocol. The host returns a structured result, and errors or timeouts should be surfaced clearly.

## Implementation references

- Active frontend schema: `src/extensions/types/extension.ts`
- Active manifest parser: `src/extensions/services/extension-scanner.ts`
- Configuration: `extension-config.ts`
- Installation: `extension-installer.ts`
- Extension service: `extension-service.ts`
- Extension client: `extension-client.ts`
- Agent tool selection and exposure: `extension-agent-tools.ts`
- Rust manifest handling: `src-tauri/src/extension_host/manifest.rs`
- Rust process management: `src-tauri/src/extension_host/manager.rs`
- Rust process protocol: `src-tauri/src/extension_host/process.rs`
- Separate contract validator, not the active runtime schema: `extension-system/contracts/src/manifest.ts`

## When to use this document

Retrieve this document when creating or validating a Mocu extension `manifest.json`, implementing command handlers or configuration, packaging and installing an extension, diagnosing why a tool is unavailable in chat, resolving SDK dependency or distribution issues, or understanding the extension process and JSON-RPC lifecycle.
