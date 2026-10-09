---
id: mocu-extension-sdk-local-vendoring-and-packaging
title: Mocu SDK Local Packaging
description: Explains how to locate Mocu SDK sources and default extension
  examples, vendor unpublished Node or Python SDK packages locally, package an
  extension ZIP, and verify a clean install. Retrieve it when an extension
  author asks about SDK paths, npm E404, vendoring, or extension distribution.
keywords:
  - Mocu extension SDK
  - unpublished npm package
  - npm E404
  - local SDK vendoring
  - file dependency
  - extension ZIP packaging
  - Node.js SDK
  - extension-contracts
  - Python SDK
  - clean install verification
  - MOCU GLOBAL DIRECTORY
  - extensions-default
  - appDataDir
  - SDK source location
  - اکستنشن
---
# Mocu SDK Local Packaging

## Public package availability

As of October 5, 2026, do not tell extension authors they can install Mocu’s Node SDK from the public npm registry by adding `"@mocu/extension-sdk": "0.1.0"` and running `npm install`.

Verification with `npm view @mocu/extension-sdk@0.1.0 version` returned npm E404. The package is not currently available from public npm; E404 alone does not distinguish an unpublished package from one that is private or inaccessible.

Mocu’s extension installer runs `npm install` in the extracted extension folder. It cannot resolve a dependency from Mocu’s global resource directory or source repository. A portable Node extension must include copies of the SDK and its runtime dependency, `@mocu/extension-contracts`, within the extension package or ZIP. Do not depend on paths outside the extension.

For API usage, see [Mocu Extension SDK Reference](mocu-extension-sdk-reference.md). For the full extension workflow, see [Mocu Extension Development](mocu-extension-development.md) and [Mocu Extension Runtime](mocu-extension-runtime.md).

## Locate SDK sources and default examples

Use the **MOCU GLOBAL DIRECTORY** context provided at runtime as the only source for Mocu’s global app-data root. Join that root with the relevant directory name; do not hard-code a username, platform-specific app-data path, or guessed location.

- `<resolved global app-data>/extension-system` contains the `sdk-node`, `sdk-python`, and `contracts` source packages for development and build-time use.
- `<resolved global app-data>/extensions-default` contains shipped extension child folders. Inspect their `manifest.json` files and source as real examples or installable defaults.
- `<resolved global app-data>/extensions-default` is **not** the installed-extension directory.
- Installed extensions are under `<resolved global app-data>/extensions/<sanitized id>`.

In a development checkout, the corresponding source directories are `install-resources/extension-system` and `install-resources/extensions-default`. These repository paths are distinct from user-specific app-data paths.

When working in Tauri code without the injected MOCU GLOBAL DIRECTORY context, resolve app-data dynamically with `appDataDir()` or `BaseDirectory.AppData`. Do not guess or hard-code an OS-specific path.

Do not assume extension child processes receive a Mocu global path environment variable. The host currently supplies only `MOCU_EXTENSION_ID` and `MOCU_EXTENSION_ROOT`. Installed runtime code must not rely on the global app-data directory.

## Package the Node SDK locally

Copy the required SDK package and its dependencies from `extension-system` into the extension’s own folder before packaging or installing it. The installed extension must not depend on a path outside its folder.

For example, from the extension root in PowerShell, with `$AppData` set to the resolved global app-data directory:

```powershell
$sdkRoot = Join-Path $AppData "extension-system"
New-Item -ItemType Directory -Force "vendor/extension-sdk", "vendor/extension-contracts" | Out-Null
Copy-Item (Join-Path $sdkRoot "sdk-node/package.json") "vendor/extension-sdk/"
Copy-Item (Join-Path $sdkRoot "sdk-node/dist") "vendor/extension-sdk/" -Recurse
Copy-Item (Join-Path $sdkRoot "contracts/package.json") "vendor/extension-contracts/"
Copy-Item (Join-Path $sdkRoot "contracts/dist") "vendor/extension-contracts/" -Recurse
```

The packaged structure should look like:

```text
my-extension/
├── manifest.json
├── package.json
├── index.js
└── vendor/
    ├── extension-sdk/package.json
    ├── extension-sdk/dist/...
    ├── extension-contracts/package.json
    └── extension-contracts/dist/...
```

The extension root should reference the SDK as a local file dependency:

```json
{
  "type": "module",
  "dependencies": {
    "@mocu/extension-sdk": "file:./vendor/extension-sdk"
  }
}
```

The SDK package must also resolve its `@mocu/extension-contracts` runtime dependency from the copied local `vendor/extension-contracts` package. For example, set the SDK package dependency to `"file:../extension-contracts"` and verify this with the npm version used for packaging.

Do not use any `file:` path that points outside the distributed extension. Include package manifests, package exports, and compiled `dist` files for both packages. Copying TypeScript source alone or omitting the contracts package can cause imports to fail. In `index.js`, continue importing from `@mocu/extension-sdk`.

The Node SDK requires Node.js >=20. Mocu’s installer skips `node_modules` and runs `npm install` after installing the extension. Include `vendor` and the package manifests in the ZIP, but exclude `node_modules`.

## Verify before distribution

1. Create a clean staging copy of the extension without `node_modules`.
2. Include the SDK and contracts package manifests and built outputs.
3. From the staged extension root, run `npm install`. It must succeed without access to the Mocu repository or reliance on repository-relative paths.
4. Confirm that `import ... from "@mocu/extension-sdk"` resolves.
5. Run `node index.js`. It should wait for host JSON-RPC on stdin; keep stdout reserved for protocol traffic.
6. Install the ZIP in Mocu and execute a real command.

A repository example that vendors the built SDK and contracts is `extensions-examples/telegram`; see its `scripts/vendor-sdk.js` and `scripts/build.js`. Other examples use local `file:./vendor/...` dependencies.

## Python SDK distinction

The Python SDK source is under `<resolved global app-data>/extension-system/sdk-python` on an installed app. In a development checkout, use `install-resources/extension-system/sdk-python`. Do not assume that `pip install mocu-extension-sdk` is available on PyPI; Mocu’s extension installer does not run pip.

For a portable Python extension, copy the `mocu_extension_sdk/` package from the SDK source into the extension (for example, `vendor/mocu_extension_sdk/`) and make that local copy importable. Do not let an installed extension depend on Mocu’s global app-data path. See [Mocu Extension Development](mocu-extension-development.md) for the Python SDK entry point and runtime.

## When to use this document

Retrieve this document when a user asks where SDK sources or shipped default extension examples are located, encounters npm E404, asks whether the SDK must be included in the extension folder, or is packaging or distributing a Node or Python extension.
