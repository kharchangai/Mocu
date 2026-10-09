---
id: mocu-extension-runtime
title: Mocu Extension Runtime
description: Explains Mocu’s active extension manifest, commands, configuration,
  installation, resource discovery, selection, process lifecycle, and SDK
  dependency packaging caveats. Retrieve it when implementing, packaging,
  installing, or troubleshooting a Mocu extension, its tools, settings, or
  global resources.
keywords:
  - manifest.json
  - commands
  - config
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
  - global extension resources
  - extensions-default
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

## Discovering Mocu’s global extension resources

When agent instructions provide a user-specific absolute root in the **MOCU GLOBAL DIRECTORY** context, use that exact root to discover global extension resources. Append the relevant directory name—`extension-system`, `extensions-default`, or `extensions`—and inspect the actual contents. Do not hard-code a user’s home directory, use a platform-specific path, or infer a global path from the current project.

The global app-data directories have distinct roles:

- `extension-system` contains the SDK and contracts source tree: `sdk-node`, `sdk-python`, and `contracts`.
- `extensions-default` contains shipped, browsable, installable default extension source folders. Each default extension folder has its own `manifest.json`.
- `extensions/<sanitized id>` contains installed extensions.

The bundled default catalog at `extensions-default` is not the installed extensions directory. Inspect a default extension’s manifest and source files to verify what it offers; do not assume capabilities from its name alone. Use Mocu’s install and management flow rather than modifying bundled defaults in place.

A distributed or installed extension must not depend on the global SDK or default-extension folders at runtime. Vendor the SDK and any required dependencies into the extension package. In a source checkout, the corresponding resource directories are `install-resources/extension-system` and `install-resources/extensions-default`; these are not the installed user’s global paths.

When writing Tauri-side code without injected directory context, resolve the app-data directory using `appDataDir()` or `BaseDirectory.AppData`. Extension child processes are not given a global-app-data environment variable, so do not assume one exists.

## SDK dependency installation and packaging caveats

Mocu’s Node installer runs `npm install` inside the installed extension folder. It does not have access to Mocu’s SDK resource directory or source repository, so an extension cannot rely on dependencies available there at runtime.

- In a development checkout, SDK packages are under `install-resources/extension-system` (`sdk-node`, `sdk-python`, and `contracts`). In an installed app, discover the global app-data root as described above and inspect its `extension-system/` directory; do not hard-code a platform-specific path.
- For Node.js, copy `sdk-node/package.json` and `sdk-node/dist/` into the extension, for example as `vendor/extension-sdk/`. Copy `contracts/package.json` and `contracts/dist/` alongside it as `vendor/extension-contracts/`.
- Set local `file:` dependencies that resolve only within the extension package; never reference the Mocu global SDK path from an installed extension.
- Include built `dist` files and manifests in the ZIP. Exclude `node_modules`; Mocu recreates it by running `npm install`.
- Validate installation from a clean staged copy before distributing the package.

For Python, copy `sdk-python/mocu_extension_sdk/` from the same SDK source into the extension, and make that local copy importable. The Python installer does not run `pip`; do not assume Python SDK dependencies are available on PyPI.

See [SDK Local Vendoring and Packaging](mocu-extension-sdk-local-vendoring-and-packaging.md) for the canonical copy commands and clean-install verification, [Extension Development](mocu-extension-development.md) for creation steps, and [SDK API Reference](mocu-extension-sdk-reference.md) for API details.

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

Retrieve this document when creating or validating a Mocu extension `manifest.json`, implementing command handlers or configuration, discovering global SDK/default/installed extension resources, packaging and installing an extension, diagnosing why a tool is unavailable in chat, resolving SDK dependency or distribution issues, or understanding the extension process and JSON-RPC lifecycle.
