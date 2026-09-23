# Wire Protocol Reference (JSON-RPC 2.0 over stdin/stdout)

**Search keywords:** protocol, jsonrpc, json-rpc 2.0, wire format, stdin,
stdout, newline-delimited, ndjson, extension.execute, request, response,
notification, id, params, result, error, success, output, host methods,
mocu.llm.generate, mocu.decision.ask, mocu.embedding.embed,
mocu.extension.activity, mocu.extension.interact, timeout, error handling, spawn, entry point,
message framing, config param

The host and the extension communicate with **JSON-RPC 2.0** messages, one
JSON object per line, over the extension's **stdin** (host → extension) and
**stdout** (extension → host). **stderr is free for logs.**

## Message types

| Type | Has `id` | Direction |
|------|----------|-----------|
| Request | yes | both ways |
| Notification | no | both ways |
| Response (success) | yes | reply to a request |
| Response (error) | yes (or `null`) | reply to a request |

## Host → Extension: `extension.execute`

The only method the host calls on extensions:

```json
{ "jsonrpc": "2.0", "id": "uuid", "method": "extension.execute",
  "params": { "command": "ask", "input": { "prompt": "hi" } } }
```

`params` (`ExtensionExecuteParams`):

| Field | Type | Meaning |
|-------|------|---------|
| `command` | string | Command id from the manifest's `commands[].id`. |
| `input` | any | Caller-supplied input (often an object). |
| `context` | object | Host-provided metadata (`toolCallId`, `toolName` for streaming commands). Empty object when absent. |
| `config` | object | User-filled values for the manifest's `config` fields (API keys, URLs, ...), merged with declared defaults. Empty object when the manifest declares no config fields. See [user-config.md](user-config.md). |

## Extension → Host: execute response

The extension must reply with **exactly one** response per request id:

```json
{ "jsonrpc": "2.0", "id": "uuid",
  "result": { "success": true, "output": "anything JSON" } }
```

```json
{ "jsonrpc": "2.0", "id": "uuid",
  "result": { "success": false, "error": "Unknown command: foo" } }
```

`ExtensionExecuteResult`:

| Field | Type | Meaning |
|-------|------|---------|
| `success` | boolean | Required. |
| `output` | any | Result payload on success. |
| `error` | string | Error message on failure. |

The `output` value is what the chat / agent tool receives (normalized to
text by `extension-agent-loader.ts`).

## Extension → Host: `mocu.llm.generate` (request)

```json
{ "jsonrpc": "2.0", "id": 7, "method": "mocu.llm.generate",
  "params": { "prompt": "hi", "systemPrompt": "Be brief." } }
```

Host reply: `{ "jsonrpc": "2.0", "id": 7, "result": { "text": "..." } }`.
Details: [llm-calls.md](llm-calls.md).

## Extension → Host: `mocu.decision.ask` (request)

```json
{ "jsonrpc": "2.0", "id": 9, "method": "mocu.decision.ask",
  "params": { "state": "...", "questions": { "...": {} } } }
```

Host reply: `{ "jsonrpc": "2.0", "id": 9, "result": { ... } }` — the raw
OpenRouter Decisions API result via Mocu's configured Jev model.
Details: [decision-model.md](decision-model.md).

## Extension → Host: `mocu.embedding.embed` (request)

```json
{ "jsonrpc": "2.0", "id": 11, "method": "mocu.embedding.embed",
  "params": { "texts": ["hello"] } }
```

Host reply: `{ "jsonrpc": "2.0", "id": 11,
"result": { "embeddings": [[...]] } }` — one vector per input text, via
Mocu's configured embedding model. Details:
[embedding-model.md](embedding-model.md).

## Extension → Host: `mocu.extension.activity` (notification)

One-way progress streaming; no response is ever sent:

```json
{ "jsonrpc": "2.0", "method": "mocu.extension.activity",
  "params": { "toolCallId": "...", "toolName": "...", "text": "..." } }
```

Details: [streaming-activity.md](streaming-activity.md).

## Extension → Host: `mocu.extension.interact` (request)

Interactive commands declare `interactive: true` in their manifest, then send
this request while their `extension.execute` call is running:

```json
{
  "jsonrpc": "2.0",
  "id": 13,
  "method": "mocu.extension.interact",
  "params": {
    "command": "guided-task",
    "context": { "chatId": "chat-id", "toolCallId": "tool-id" },
    "title": "Choose an action",
    "message": "How should I continue?",
    "input": true,
    "inputPlaceholder": "Reply to the extension…",
    "buttons": [
      { "id": "continue", "label": "Continue", "variant": "primary" },
      { "id": "cancel", "label": "Cancel", "variant": "danger" }
    ]
  }
}
```

Mocu displays the interaction in that chat and leaves the request pending. A
user's text submission replies with `{ "actionId": "__input__", "input": "..." }`;
a button replies with `{ "actionId": "continue" }`. The extension handles the
result and may issue another interaction request. A Node SDK interaction may
be cancelled with a `mocu.extension.interaction.cancel` notification carrying
the local interaction request id; Mocu then dismisses the card. See
[chat-interaction.md](chat-interaction.md).

## Error responses (JSON-RPC level)

If a request cannot be processed at all, respond with a JSON-RPC error:

```json
{ "jsonrpc": "2.0", "id": "uuid", "error": { "code": -32601, "message": "Method not found" } }
```

## Constants (from `extension-system/contracts/src/protocol.ts`)

- `EXTENSION_METHODS.execute` = `"extension.execute"`
- `HOST_METHODS.llmGenerate` = `"mocu.llm.generate"` (`llm.ts`)
- `HOST_METHODS.decisionAsk` = `"mocu.decision.ask"` (`decision.ts`)
- `HOST_METHODS.embeddingEmbed` = `"mocu.embedding.embed"` (`embedding.ts`)
- `HOST_METHODS.extensionInteract` = `"mocu.extension.interact"`
- `HOST_METHODS.extensionInteractionCancel` = `"mocu.extension.interaction.cancel"`
- Activity method (used by SDKs/examples): `"mocu.extension.activity"`

## Timeout behavior

- Default execute timeout: **900 s** (15 min).
- Override per command with `timeoutSeconds` in the manifest; `0` disables
  the timeout; values > 86400 (24 h) are clamped.
- On timeout the pending request is rejected with a timeout error; the
  extension process is **not** necessarily killed — keep commands responsive.

## Spawn details (Rust host, `process.rs`)

- Node: `node <entry>`
- Python: `python <entry>` (Windows) or `python3 <entry>` (Unix)
- The host reads stdout line-by-line and parses each line as JSON; a line
  that is not valid JSON is discarded (but avoid producing any).
- The process is kept alive between commands (lazy activation).

## Implementing the protocol without the SDK

Possible but not recommended. You must: read stdin line-by-line, parse each
line, dispatch `extension.execute` to your handlers, write single-line JSON
responses with matching ids, and issue host requests with unique ids,
matching responses to pending requests. Use the SDKs
([node-sdk.md](node-sdk.md), [python-sdk.md](python-sdk.md)).

## Related documents

- Architecture and process model: [architecture.md](architecture.md)
- Manifest: [manifest-reference.md](manifest-reference.md)
