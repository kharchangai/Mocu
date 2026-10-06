---
id: mocu-extension-sdk-local-vendoring-and-packaging
title: "# Mocu Extension SDK: Local Vendoring and Packaging"
description: Canonical guide for distributing Mocu extensions with the
  unpublished SDK bundled locally, including npm E404 context, Node SDK and
  contracts vendoring, Python packaging, ZIP contents and clean-install
  verification.
keywords:
  - Mocu extension SDK
  - unpublished npm
  - npm E404
  - vendoring
  - local file dependency
  - SDK copy
  - extension ZIP
  - Node.js SDK
  - extension-contracts
  - Python SDK
  - اکستنشن
  - افزونه
  - SDK منتشر نشده
---
# Mocu SDK Packaging

## Public package availability

As of October 5, 2026, do not tell extension authors they can install Mocu’s Node SDK from the public npm registry by adding `"@mocu/extension-sdk": "0.1.0"` and running `npm install`.

Verification with `npm view @mocu/extension-sdk@0.1.0 version` returned npm E404. The package is not currently available from public npm; E404 alone does not distinguish an unpublished package from one that is private or inaccessible.

Mocu’s extension installer runs `npm install` in the extracted extension folder. It cannot resolve a dependency from Mocu’s source repository. A portable Node extension must include copies of the SDK and its runtime dependency, `@mocu/extension-contracts`, within the extension package or ZIP. Do not depend on source-repository-relative paths.

For API usage, see [Mocu Extension SDK Reference](mocu-extension-sdk-reference.md). For the full extension workflow, see [Mocu Extension Development](mocu-extension-development.md) and [Mocu Extension Runtime](mocu-extension-runtime.md).

## Package the Node SDK locally

Build from the repository’s `extension-system/sdk-node` and `extension-system/contracts` sources. Include both packages’ built outputs and package manifests under the extension. For example:

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

The SDK package must also resolve its `@mocu/extension-contracts` runtime dependency from a locally vendored package. One possible arrangement is `"@mocu/extension-contracts": "file:../extension-contracts"` in the vendored SDK package manifest, provided it works with the target npm version and package layout. Another tested, self-contained local arrangement is also acceptable.

Do not use any `file:` path that points outside the distributed extension. Include package manifests, package exports, and compiled `dist` files for both packages. Copying TypeScript source alone or omitting the contracts package can cause imports to fail. In `index.js`, continue importing from `@mocu/extension-sdk`.

The Node SDK requires Node.js >=20. Mocu’s installer skips `node_modules` and runs `npm install` after installing the extension. Therefore, include `vendor` and the package manifests in the ZIP, but exclude `node_modules`.

## Verify before distribution

1. Create a clean staging copy of the extension without `node_modules`.
2. Include the SDK and contracts package manifests and built outputs.
3. From the staged extension root, run `npm install`. It must succeed without access to the Mocu repository or reliance on repository-relative paths.
4. Confirm that `import ... from "@mocu/extension-sdk"` resolves.
5. Run `node index.js`. It should wait for host JSON-RPC on stdin; keep stdout reserved for protocol traffic.
6. Install the ZIP in Mocu and execute a real command.

A repository example that vendors the built SDK and contracts is `extensions-examples/telegram`; see its `scripts/vendor-sdk.js` and `scripts/build.js`. Other examples use local `file:./vendor/...` dependencies.

## Python SDK distinction

The Python SDK lives in `extension-system/sdk-python`. Do not assume that `pip install mocu-extension-sdk` is available on PyPI. Mocu’s extension installer does not run pip.

For a portable Python extension, include the SDK package in the extension folder and ensure Python imports resolve from that local copy, or clearly document and test any external prerequisite. See [Mocu Extension Development](mocu-extension-development.md) for the Python SDK entry point and runtime.

## When to use this document

Retrieve this document when a user asks whether the Mocu SDK can be installed from npm or PyPI, encounters npm E404, asks whether the SDK must be included in the extension folder, or is packaging or distributing a Node or Python extension.
