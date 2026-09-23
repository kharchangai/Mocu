# Manifest Reference (`manifest.json`)

**Search keywords:** manifest.json, manifest fields, id, name, version,
runtime, entry, commands, streaming, interactive, timeoutSeconds, permissions, engines,
configuration, manifestVersion, validation, reverse-domain, semver,
invalid manifest, validation error, command id, title, description,
config, user settings, api key, form

Every extension must have a `manifest.json` at the **root of its folder**.
The host (Rust) and the frontend scanner both parse this file; invalid
manifests are rejected at install/scan time.

## Full example

```json
{
  "id": "pi-node",
  "name": "Pi Agent",
  "description": "Embeds a pi coding-agent session inside the extension.",
  "version": "0.1.0",
  "runtime": "node",
  "entry": "index.js",
  "engines": { "node": ">=20" },
  "permissions": ["filesystem", "shell"],
  "commands": [
    {
      "id": "ask",
      "title": "Ask pi",
      "description": "Send a prompt and return its final response.",
      "streaming": true,
      "interactive": false,
      "timeoutSeconds": 900
    }
  ],
  "config": [
    {
      "key": "apiKey",
      "label": "Service API key",
      "type": "password",
      "required": true
    }
  ]
}
```

## Required fields (top level)

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Non-empty. Reverse-domain style recommended, e.g. `com.example.hello`. Must match `^[a-z0-9]+(?:[._-][a-z0-9]+)+$` (lowercase, at least one `.` / `-` / `_` separator). Used as the unique registry key and agent-tool name part. |
| `name` | string | Human-readable extension name. |
| `description` | string | Human-readable description; shown in the Extensions page and used when matching @-mentions in chat. |
| `version` | string | Semantic version, e.g. `1.0.0` (pre-release suffix allowed: `1.0.0-beta.1`). |
| `runtime` | string | `"node"` or `"python"` — nothing else is accepted. |
| `entry` | string | Entry file **relative to the extension directory**, e.g. `index.js`, `dist/main.js`, `main.py`. Must not be absolute or contain `../`. |

## Optional fields (top level)

| Field | Type | Meaning |
|-------|------|---------|
| `commands` | array | Declared commands. **Required in practice** — the host uses it for timeouts/streaming and the frontend uses it to build agent tools. See below. |
| `engines` | object | Runtime compatibility hints, e.g. `{ "node": ">=20", "python": ">=3.10", "mocu": ">=0.1" }`. |
| `permissions` | string[] | Descriptive only (e.g. `"filesystem"`, `"shell"`). They do **not** provide a sandbox in the current implementation. |
| `configuration` | object | Reserved for extension-specific config schema/defaults. |
| `config` | array | **Inputs the user must fill in** for the extension to work (API keys, base URLs, ...). Rendered as a Settings form on the extension's card in the Extensions page; saved values are delivered to every command as the `config` param. Full field reference and examples: [user-config.md](user-config.md). |
| `manifestVersion` | number | Must be `1` in the contracts validator. |

## The `commands` array

Each entry:

| Field | Type | Meaning |
|-------|------|---------|
| `id` | string | Command identifier. Mocu calls it via `extension.execute` with `params.command` equal to this id. |
| `title` | string | Short human-readable title (shown in UI). |
| `description` | string | What the command does. Injected into the agent system prompt, so write it so an LLM can decide when to call the command. |
| `streaming` | bool | When `true`, the command may stream live progress to the chat via `mocu.extension.activity` notifications. See [streaming-activity.md](streaming-activity.md). |
| `interactive` | bool | When `true`, the command may display extension-defined buttons and request text input in Mocu chat. See [chat-interaction.md](chat-interaction.md). |
| `timeoutSeconds` | number | Per-command timeout in seconds. Omitted → default **900s**. `0` → **no timeout** (wait until the extension answers). Values above 86400 (24h) are clamped. |

Interactive commands should usually set `timeoutSeconds` to `0` so users have enough time to respond.

Note the casing: inside `commands` entries the field is `timeoutSeconds`
(camelCase) because the Rust host deserializes with `rename_all = "camelCase"`.

## The `config` array (user settings)

Each entry declares one input the user fills in on the extension's card:

| Field | Type | Meaning |
|-------|------|---------|
| `key` | string | Required. Key the value is delivered under. |
| `label` | string | Required. Label shown in the form. |
| `description` | string | Helper text below the input. |
| `type` | string | `"string"` (default), `"number"`, `"boolean"`, or `"password"` (masked — for API keys). |
| `required` | bool | Form refuses to save when empty. |
| `default` | string / number / bool | Used when the user has not filled anything in. |
| `placeholder` | string | Placeholder text in the empty input. |

Entries without a non-empty string `key` and `label` are ignored by the
scanner. Saved values are merged with `default`s and sent to the extension
as the `config` param of `extension.execute` on **every** command call.
Details: [user-config.md](user-config.md).

## Common validation errors and fixes

| Error message | Cause / fix |
|---------------|-------------|
| `id must use a reverse-domain style identifier such as com.example.extension.` | Id has no separator or contains uppercase/spaces. Use e.g. `com.me.my-tool`. |
| `version must be a semantic version such as 1.0.0.` | Version like `1.0` or `v1.0.0`. Use three-part semver. |
| `runtime must be either "node" or "python".` | Typo in runtime. |
| `entry must be a safe relative path inside the extension directory.` | Entry is absolute, starts with `/` or a drive letter, or contains `../`. |
| `Manifest field 'x' is required` (scanner) | Missing required top-level string field. |
| `manifestVersion must be 1.` | Wrong or missing `manifestVersion` (contracts validator). |

## Where the manifest is validated

- Rust host: `src-tauri/src/extension_host/manifest.rs` (serde; required
  strings, runtime enum, commands array).
- Frontend scanner: `src/extensions/services/extension-scanner.ts`
  (required fields: `id`, `name`, `description`, `version`, `entry`).
- Contracts validator (TS): `extension-system/contracts/src/manifest.ts`
  (`validateExtensionManifest`, full rules incl. id/semver regexes).

The **strictest** rules (reverse-domain id, semver, safe entry path) come
from the contracts validator — follow them to be safe everywhere.

## Related documents

- Building the entry file: [node-sdk.md](node-sdk.md) / [python-sdk.md](python-sdk.md)
- Packaging and installing: [installation.md](installation.md)
