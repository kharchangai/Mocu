# Guide for AI Agents: Creating a Mocu Extension for a User

**Search keywords:** agent guide, create extension for user, workflow,
checklist, decision node or python, scaffold, template, step by step, how
to build, generate extension, boilerplate, test plan, deliver, zip,
documentation for agents, ai assistant

You are an AI agent asked to build a Mocu extension for a user. Follow this
workflow. Reference docs are listed per step.

## Step 0 — Gather requirements

Ask (or infer) from the user's request:

1. **What should the extension do?** Derive one or more **commands** (each
   command = one capability an agent or user can invoke).
2. **Runtime**: choose `node` or `python`:
   - `node` — needs npm packages, streaming/progress support, or best
     performance. **Default choice.**
   - `python` — user prefers Python or needs Python-only libraries.
   See [architecture.md](architecture.md).
3. **Does it need AI?** If yes, use the host LLM — [llm-calls.md](llm-calls.md).
4. **Long-running?** If yes, add `streaming: true` and a suitable
   `timeoutSeconds` — [streaming-activity.md](streaming-activity.md),
   [manifest-reference.md](manifest-reference.md).

## Step 1 — Scaffold the project

Create a folder with this layout (Node shown):

```
<extension-name>/
├── manifest.json
├── package.json     (node only)
└── index.js         (or main.py)
```

Rules:

- **id**: reverse-domain, lowercase, at least one separator: `com.<author>.<name>`.
- **version**: semver `1.0.0`.
- **entry**: matches the actual file.
- One `commands[]` entry per capability with a **clear LLM-oriented
  description** — this text is injected into agent prompts and drives tool
  selection.

Full field reference: [manifest-reference.md](manifest-reference.md).

## Step 2 — Write the code

- Node: [node-sdk.md](node-sdk.md) — `createExtension({ commands })` +
  `extension.start()`. Redirect `console.log` to stderr.
- Python: [python-sdk.md](python-sdk.md) — `@extension.command` +
  `extension.run()`. Never `print()` to stdout.
- Handler signature: `(input, context)`; return JSON-serializable values;
  throw `Error` for failures.
- Need the LLM? `extension.llm.generate({...})` → `{ text }`.
- Never write to stdout except through the SDK.

## Step 3 — Validate

Checklist before delivering:

- [ ] `manifest.json` validates (id regex, semver, runtime, safe entry) —
      [manifest-reference.md](manifest-reference.md).
- [ ] Every manifest command id has a registered handler (else
      "Unknown command").
- [ ] Entry runs standalone and waits silently
      (`node index.js` / `python main.py`).
- [ ] No stray stdout output.
- [ ] `package.json` declares all npm dependencies; no `node_modules` in
      the deliverable.
- [ ] Commands that take long declare `timeoutSeconds`; commands with
      progress declare `"streaming": true`.

## Step 4 — Package and deliver

1. Zip the folder with `manifest.json` at the ZIP root (or inside one
   top-level folder).
2. Tell the user to install it via Mocu's **Extensions page**
   ([installation.md](installation.md)). Node dependencies install
   automatically; Python dependencies must be handled per
   [python-sdk.md](python-sdk.md).
3. After install, each command is callable in chat as an agent tool named
   `extension_<id>_<commandId>` and via @-mention of the extension.

## Step 5 — Test and iterate

- Ask the user to run a command from chat; watch for:
  - timeout → start() missing, entry wrong, or dependency missing
    ([examples.md](examples.md) → Troubleshooting).
  - "Unknown command" → handler/manifest mismatch.
  - Garbled protocol → stdout pollution.
- To ship a fix: rebuild the ZIP and reinstall; installing at a new path
  automatically stops the old process
  ([architecture.md](architecture.md)).

## Quick templates

Use the repo examples as templates: `extensions-examples/time-node` (basic),
`hi-llm-node` (LLM), `pi-node` (streaming + multi-command). Catalog:
[examples.md](examples.md).

## Doc lookup table

| Need | Read |
|------|------|
| What an extension is / process model | [architecture.md](architecture.md) |
| Manifest fields, validation errors | [manifest-reference.md](manifest-reference.md) |
| Node code | [node-sdk.md](node-sdk.md) |
| Python code | [python-sdk.md](python-sdk.md) |
| AI/LLM features | [llm-calls.md](llm-calls.md) |
| Progress streaming | [streaming-activity.md](streaming-activity.md) |
| Packaging/install | [installation.md](installation.md) |
| Wire protocol details | [protocol-reference.md](protocol-reference.md) |
| Debugging / FAQ | [examples.md](examples.md) |
