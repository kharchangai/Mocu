# Streaming Live Progress to the Chat (Activity Notifications)

**Search keywords:** streaming, activity, mocu.extension.activity, notify,
live progress, progress stream, toolCallId, toolName, text delta, flush,
buffer, pre block, chat render, long running command, streaming true,
throttle, notification, one-way

Long-running commands (agent loops, big downloads, multi-step jobs) can
stream live progress text into the Mocu chat while they run. The stream is
rendered inside the tool card of the calling agent, in a `<pre>` block.

## Requirements

1. The command must set **`"streaming": true`** in its manifest entry
   (see [manifest-reference.md](manifest-reference.md)).
2. The command sends **one-way JSON-RPC notifications** with method
   **`mocu.extension.activity`** while it runs.
3. Currently supported in the **Node SDK** (via `extension.notify`).

## Node usage

```js
const extension = createExtension({
  commands: {
    ask: async (input, context, config) => {
      const notify = (text) =>
        extension.notify("mocu.extension.activity", {
          toolCallId: context?.toolCallId,
          toolName: context?.toolName,
          text,                     // plain text delta
        });

      notify("Starting work...\n");
      for (const step of steps) {
        await step();
        notify(`Done: ${step.name}\n`);
      }
      return "all finished";
    },
  },
});
```

## Notification params

| Field | Type | Meaning |
|-------|------|---------|
| `toolCallId` | string \| undefined | From `context.toolCallId`. Routes the text into the correct chat tool card. |
| `toolName` | string \| undefined | From `context.toolName`. Display name in the UI. |
| `text` | string | The progress text to append. Plain text; rendered in a `<pre>` block. |

The `context` object passed to your command handler carries `toolCallId`
and `toolName` **only when the command is invoked as an agent tool with
streaming enabled** — always guard with `context?.toolCallId`.

## Best practices (from `extensions-examples/pi-node`)

- **Buffer and flush on an interval** (e.g. every 300 ms) instead of sending
  a notification per tiny delta — this avoids flooding stdout.
- **Cap the stream size**: keep the head+tail of very long output (the pi
  example keeps the last ~60,000 chars and marks the trimmed middle).
- Append text rather than replacing it — the UI treats each notification as
  an append delta.
- Everything should end up as **plain text** (format tool calls, LLM
  thinking deltas, etc. yourself).
- Stop flushing and do a final flush before returning your result.

## How it works on the wire

Notifications are JSON-RPC notifications (no `id`, no response expected):

```json
{ "jsonrpc": "2.0", "method": "mocu.extension.activity",
  "params": { "toolCallId": "abc123", "toolName": "ask", "text": "Step 1 done\n" } }
```

The frontend host service (`src/extensions/services/host-service.ts`)
receives these and forwards them to the chat UI. See
[protocol-reference.md](protocol-reference.md).

## Related documents

- Manifest `streaming` flag and `timeoutSeconds`: [manifest-reference.md](manifest-reference.md)
- Full working example: `extensions-examples/pi-node/index.js` and [examples.md](examples.md)
