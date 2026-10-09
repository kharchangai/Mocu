---
id: mocu-extension-docs-map
title: Mocu Extension Docs Map
description: This document maps common Mocu extension questions to the focused
  guide that covers them, including SDK packaging and global extension resource
  folders. Retrieve it when choosing a guide or determining where to inspect
  bundled examples, SDK sources, or installed extensions.
keywords:
  - Mocu extension documentation map
  - build an extension
  - extension development guide
  - extension runtime and installation
  - Mocu SDK reference
  - package SDK
  - npm E404
  - local vendor SDK
  - Python package caveats
  - global extension folders
  - extensions-default
  - extension-system
  - اکستنشن
  - افزونه
  - ساخت افزونه
---
# Mocu Extension Docs Map

## Choose the focused guide

Use the guide that matches the extension question:

- **Create an extension:** [Mocu Extension Development](mocu-extension-development.md) covers architecture, manifests, SDK entry points, protocol, and workflow.
- **Runtime and installation:** [Mocu Extension Runtime](mocu-extension-runtime.md) covers manifest fields, configuration, installation, extension selection, and process lifecycle.
- **SDK APIs:** [Mocu Extension SDK Reference](mocu-extension-sdk-reference.md) covers verified Node and Python API methods, parameters, host behavior, and limits. For distributing the SDK within an extension, read the explicit packaging guide below.
- **SDK packaging and distribution:** [Mocu Extension SDK Local Vendoring and Packaging](mocu-extension-sdk-local-vendoring-and-packaging.md) covers npm E404, copying the Node SDK and contracts into an extension, local dependencies, Python package caveats, and clean ZIP verification.

## Global extension resource folders

For questions about Mocu’s global extension resources, route to the Extension Development or Runtime guide, depending on whether the question concerns development examples or runtime behavior. To inspect the user’s actual bundled extension examples or defaults, use the exact app-data root supplied at runtime in the **MOCU GLOBAL DIRECTORY** context, then append `extensions-default`. Do not hard-code a user-specific or operating-system-specific path.

The global folders have distinct purposes:

- `extensions-default` is the shipped browse/install source and catalog. It contains bundled examples and defaults.
- `extension-system` contains SDK and contracts sources. For SDK source discovery, consult this folder together with the SDK local-vendoring and packaging guide.
- `extensions/<sanitized id>` contains an installed copy of an extension, where `<sanitized id>` is that extension’s sanitized identifier.

An installed extension intended to be portable must vendor its dependencies. It must not depend on global resource paths such as `extensions-default` or `extension-system`. In Tauri-side code, when no runtime context provides the app-data root, resolve it dynamically with `appDataDir()` / `BaseDirectory.AppData` rather than hard-coding a path.

## Independent extensions and SDK availability

For an independent extension, do not assume the Mocu SDK is available through public npm or PyPI. Read the local-vendoring guide and test the extension from a clean staged copy.

The documents cross-link to related guidance. Start with the relevant focused guide, then inspect source code only if a detail is missing from the guide or conflicts with the implementation.

## When to use this document

Retrieve this map when choosing which Mocu extension guide to consult, including questions about development, runtime, SDK APIs, packaging, npm E404, local SDK vendoring, independent extension distribution, global extension folders, bundled examples or defaults, SDK source discovery, or installed extension locations.
