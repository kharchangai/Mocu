---
id: mocu-extension-docs-map
title: Mocu Extension Docs Map
description: Maps common Mocu extension questions to focused guides, including
  SDK APIs for host LLM generation, text summarization, structured decisions
  (Jev), embeddings, and speech, plus App UI, filesystem writes, packaging, and
  global resource folders. Retrieve it to find the right guide for an extension
  development or runtime question.
keywords:
  - Mocu extension documentation map
  - extension development guide
  - extension runtime and installation
  - Mocu SDK reference
  - extension.summarize
  - extension.summarize.text
  - extension summarization
  - خلاصه‌سازی اکستنشن
  - host LLM and Jev
  - Summarize model
  - npm E404
  - local SDK vendoring
  - Python package caveats
  - global extension folders
---
# Mocu Extension Docs Map

## Choose the focused guide

Use the guide that matches the extension question:

- **Create an extension:** [Mocu Extension Development](mocu-extension-development.md) covers architecture, manifests, SDK entry points, protocol, and workflow. It also documents how Node and Python extensions can access saved agents with `agents.invoke` and transcribe or synthesize speech through the `extension.speech` API (STT/TTS).
- **Runtime and installation:** [Mocu Extension Runtime](mocu-extension-runtime.md) covers manifest fields, configuration, installation, extension selection, and process lifecycle.
- **App UI:** [Mocu Extension App UI](mocu-extension-app-ui.md) covers the optional manifest `app` entry, an in-Mocu App sidebar page, the iframe sandbox, the browser UI SDK and message bridge, folder-scoped read and write access, and how App UI can call declared commands.
- **App UI filesystem writes:** [Mocu Filesystem Write API](mocu-filesystem-write-api.md) documents the write contract, the raw `postMessage` protocol, Rust host commands, the `filesystem.write` permission, `writeText()`, and write path security.
- **SDK APIs:** [Mocu Extension SDK Reference](mocu-extension-sdk-reference.md) covers verified Node and Python API methods, including text summarization through `extension.summarize.text` and speech (STT/TTS) through `extension.speech.transcribe` and `extension.speech.speak`. For summarization, provide source text and optionally instructions. The API uses the separately configured **Summarize model** in Mocu Settings and returns plain text in `summary` for Node or `result["summary"]` for Python. The SDK reference also documents API parameters, host behavior, and limits. For distributing the SDK within an extension, read the explicit packaging guide below.
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

Retrieve this map when choosing which Mocu extension guide to consult, including questions about development, runtime, App UI, the filesystem write API, SDK APIs, text summarization with `extension.summarize.text`, the Summarize model setting, speech transcription and synthesis (STT/TTS), packaging, npm E404, local SDK vendoring, independent extension distribution, saved-agent access with `agents.invoke`, global extension folders, bundled examples or defaults, SDK source discovery, or installed extension locations.
