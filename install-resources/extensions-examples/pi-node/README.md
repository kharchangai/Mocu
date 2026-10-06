# pi-node — Pi Agent extension for Mocu

Embeds a [pi coding-agent](https://github.com/earendil-works/pi-coding-agent)
session inside a Mocu extension using the pi SDK
(`@earendil-works/pi-coding-agent`). Mocu's chat can send prompts to pi and
receive its final response. While Pi is running, users can steer it from the
Mocu composer, stop a turn and resume the same session with new instructions,
or cancel the task.

## Commands

| Command  | Description |
| -------- | ----------- |
| `ask`    | Send a prompt to pi and return its final assistant response. |
| `reset`  | Dispose the current pi session (next `ask` starts fresh). |
| `status` | Show whether a session is active, plus its cwd, tools, model and thinking level. |

## Live streaming (`ask`)

`ask` streams **everything pi does** to Mocu while it runs. The chat tool card
shows a live log containing:

- LLM **thinking** deltas (when the model + thinking level produce them)
- assistant **response** text as it streams
- every **tool call** with its arguments (command, file path, …)
- **tool output while it runs** (e.g. a long bash command's output appears live,
  only the new part each time — the extension de-duplicates the accumulated
  partial results pi emits)
- final **tool results**, including errors and structured details like diffs
- **auto retries** (with the error that triggered them), context **compaction**,
  queued steering/follow-up messages, and user messages sent from Mocu

Example of what the streamed log looks like:

```
━━━━ pi agent started ━━━━

┌─ thinking ─
The user wants a file list. I should run ls.
└─ end thinking ─

┌─ response ─
Let me check the directory.
└─ end response ─

▶ tool: bash
  {
    "command": "ls -la"
  }
total 0
src
dist
■ bash: done

━━━━ pi agent finished ━━━━
```

Individual items are truncated (tool args ~2 KB, tool output ~4 KB per chunk)
and the whole log keeps at most the last ~60 KB, so a long agent run can't
flood the chat.

Run from chat, e.g.:

```
/extension pi-node ask "What files are in this project?"
```

## `ask` input

Either a plain string (used as the prompt) or an object:

```json
{
  "prompt": "Fix the failing test in src/foo.ts",
  "cwd": "E:/some/project",
  "tools": ["read", "grep", "find", "ls"],
  "model": "anthropic/claude-opus-4-5",
  "thinkingLevel": "medium"
}
```

- `prompt` (required) — what to send to pi.
- `cwd` — directory pi's tools operate on. Defaults to the extension's own
  process cwd. Changing it recreates the session.
- `tools` — pi built-ins to enable. Defaults to `read, bash, edit, write`
  (full coding agent). Use a read-only set for safer "explain" queries.
- `model` — `"provider/model-id"`. Defaults to pi's own settings/auth
  (`~/.pi/agent`). Changing it recreates the session.
- `thinkingLevel` — `off | minimal | low | medium | high | xhigh | max`.

## Session behavior

The session is **persistent**: consecutive `ask` calls continue the same pi
conversation (memory works across calls). Options changes transparently
recreate the session; `reset` disposes it on demand. Sessions are in-memory
only (not persisted to pi session files).

Commands are serialized inside the extension so concurrent `extension.execute`
calls can't corrupt session state.

While `ask` is running, its interaction card stays visible in Mocu chat:

- Type a message and send it to steer Pi during the current run. Pi queues it
  for the next turn after its current tool batch.
- Click **Stop Pi & wait** to abort the current Pi turn without disposing the
  session. Then type new instructions or click **Continue Pi**; Pi resumes in
  the same session with its existing task history.
- Click **Cancel task** to abort the current run and finish the extension
  command. The persistent Pi session remains available for a later `ask`.

The prompt is cancellable when Pi finishes, so its controls disappear rather
than leaving a stale interaction in Mocu chat.

## Auth

pi resolves credentials itself, in this order: `~/.pi/agent/auth.json`,
then environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...), then
custom providers from `~/.pi/agent/models.json`. Nothing to configure here if
pi already works on this machine.

## Manifest command options

Each entry in `commands` supports two optional, creator-chosen flags:

```json
{
  "id": "ask",
  "title": "Ask pi",
  "description": "...",
  "streaming": true,
  "interactive": true,
  "timeoutSeconds": 0
}
```

- `streaming` (`bool`, default `false`) — when `true`, the command may emit
  `mocu.extension.activity` notifications while it runs; the Mocu chat
  renders them live inside the command's tool card. Emit them with the SDK:
  `extension.notify("mocu.extension.activity", { toolCallId, toolName, text })`
  (`toolCallId`/`toolName` arrive in the command's `context`). Non-streaming
  commands simply never emit, and the UI stays a normal running card.
- `interactive` (`bool`, default `false`) — enables extension-defined chat
  controls and routes composer replies to the running extension.
- `timeoutSeconds` (`number`) — per-command execution timeout. Omit for the
  default (900 s); `0` means no timeout. `ask` opts out because the user may
  pause and resume the task later.

## Dependencies

Dependencies are declared with npm `file:` references — the repo carries the
local `@mocu/extension-sdk` and `@mocu/extension-contracts` packages under
`vendor/`, and `npm install` fetches `@earendil-works/pi-coding-agent` from
the registry:

```bash
npm install
```

No manual copying of `@mocu` packages into `node_modules` is needed anymore.
The Mocu Extensions catalog embeds these same files (`scripts/generate-pi-catalog.mjs`
regenerates the embedded copy) and runs `npm install` automatically when the
extension is installed from the UI.

## Host-side note

`src-tauri/src/extension_host/manager.rs` uses a 900s default timeout. The
`ask` command opts out with `timeoutSeconds: 0` because user interaction may
last longer than the default.

## Safety

With default tools, pi **runs bash commands and edits files** in `cwd` with
no human confirmation. Only point it at directories you accept that for, or
pass a read-only `tools` list.
