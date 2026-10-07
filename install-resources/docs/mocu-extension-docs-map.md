---
id: mocu-extension-docs-map
title: Mocu Extension Docs Map
description: This document maps common Mocu extension questions to the focused
  guide that covers them. Retrieve it when deciding which extension guide to
  read, especially for SDK packaging or independent extensions.
keywords:
  - Mocu extension documentation map
  - Mocu extension docs
  - build an extension
  - extension development guide
  - extension runtime and installation
  - Mocu SDK reference
  - package SDK
  - npm E404
  - local vendor SDK
  - Python package caveats
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

## Independent extensions and SDK availability

For an independent extension, do not assume the Mocu SDK is available through public npm or PyPI. Read the local-vendoring guide and test the extension from a clean staged copy.

The documents cross-link to related guidance. Start with the relevant focused guide, then inspect source code only if a detail is missing from the guide or conflicts with the implementation.

## When to use this document

Retrieve this map when choosing which Mocu extension guide to consult, including questions about development, runtime, SDK APIs, packaging, npm E404, local SDK vendoring, or distribution of an independent extension.
