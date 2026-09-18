# Installing, Packaging and Discovering Extensions

**Search keywords:** install, uninstall, zip, package, distribute, install
extension, appDataDir, extensions folder, extensions directory, npm install
automatic, node_modules, scan, scanner, discovery, catalog, ExtensionsPage,
manifest.json at root, top-level folder, refresh, agent tools, tool name,
extension_<id>_<command>

## How installation works

1. The user opens Mocu's **Extensions page** and installs a **ZIP file**.
2. The ZIP must contain `manifest.json` **at its root, or inside exactly one
   top-level folder** (e.g. `my-ext/manifest.json` is fine).
3. The installer extracts it to: `<appDataDir>/extensions/<folder-name>/`
   (`appDataDir` is the OS app-data directory for Mocu; on Windows:
   `%APPDATA%/<bundle-id>`).
4. For **Node** extensions, the installer automatically runs
   `npm install` inside the installed directory so dependencies become
   runnable right after installation (`node_modules` is skipped when
   copying from an existing folder).
   For **Python** extensions there is **no automatic `pip install`** —
   handle dependencies yourself (see [python-sdk.md](python-sdk.md)).
5. `node_modules` in the ZIP is ignored/skipped by the installer.

## Folder layout after install

```
<appDataDir>/extensions/
└── my-ext/
    ├── manifest.json
    ├── index.js
    ├── package.json
    └── node_modules/   (created by automatic npm install)
```

## Discovery / scanning

The frontend **scans** the `extensions` directory at startup and on refresh
(`src/extensions/services/extension-scanner.ts`):

- Reads each subfolder's `manifest.json`; folders with missing/invalid
  manifests are skipped (with a logged error).
- The result is the list of **installed extensions** shown in the Extensions
  page and usable as @-mentions in chat (matched by name, id, or
  description — see `extensionMention.ts`).

## Extension commands as agent tools

Installed extension commands are automatically exposed to Mocu's AI agents
(`src/extensions/services/extension-agent-tools.ts`):

- Tool name format: `extension_<id>_<commandId>`, sanitized to
  `[a-z0-9_]` (e.g. `extension_pi_node_ask`).
- The command `description` from the manifest is injected into the agent's
  system prompt — **write descriptions an LLM can act on**.
- Limits: max **24 tools per agent**, tool names max **64 chars**.
- Agents select extensions by id; ids not installed are reported back as
  "missing".

## Uninstall / reinstall

- Uninstalling deletes the extension folder from `<appDataDir>/extensions/`.
- Re-installing the same id at the same path is a no-op for a running
  process; installing a different path for the same id **stops the old
  process** so the next command runs the new files
  (see [architecture.md](architecture.md)).

## Packaging checklist (ZIP)

- [ ] `manifest.json` at ZIP root (or inside one top-level folder).
- [ ] Manifest passes validation — see [manifest-reference.md](manifest-reference.md).
- [ ] Entry file path matches `"entry"`.
- [ ] `package.json` present with dependencies declared (Node).
- [ ] **No `node_modules` in the ZIP** (npm install runs after extraction).
- [ ] Entry writes nothing to stdout except via the SDK
      ([node-sdk.md](node-sdk.md) / [python-sdk.md](python-sdk.md)).
- [ ] Tested locally: `node index.js` (or `python main.py`) starts and waits
      silently on stdin.

## Related documents

- Architecture / lazy activation: [architecture.md](architecture.md)
- Manifest reference: [manifest-reference.md](manifest-reference.md)
- Example catalog: [examples.md](examples.md)
