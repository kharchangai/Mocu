# Building a Node.js Extension (`@mocu/extension-sdk`)

**Search keywords:** node extension, node.js, npm, @mocu/extension-sdk,
createExtension, registerCommand, commands, start, handler, input, context,
ESM, type module, package.json, index.js, entry file, tutorial, example,
console.log stdout, stderr, async command, execute override

## Project layout

```
my-extension/
├── manifest.json
├── package.json
└── index.js        <- entry (must match manifest "entry")
```

`package.json` (the extension is an ES module):

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@mocu/extension-sdk": "0.1.0"
  }
}
```

Install dependencies locally during development:

```bash
npm install
node index.js   # it will wait silently for JSON-RPC on stdin
```

When the extension is installed into Mocu, the installer runs `npm install`
automatically — see [installation.md](installation.md).

## Minimal extension

```js
import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    // handler signature: (input, context) => result (sync or async)
    hello(input) {
      return `Hello, ${input?.name ?? "world"}!`;
    },
  },
});

extension.start(); // start the stdin JSON-RPC loop — required!
```

`manifest.json`:

```json
{
  "id": "com.example.my-extension",
  "name": "My Extension",
  "description": "Greets the user.",
  "version": "1.0.0",
  "runtime": "node",
  "entry": "index.js",
  "commands": [
    { "id": "hello", "title": "Say hello", "description": "Returns a greeting." }
  ]
}
```

## SDK API (`MocuExtension`)

| Member | Description |
|--------|-------------|
| `createExtension(definition)` | Factory; same as `new MocuExtension(definition)`. |
| `definition.commands` | `Record<string, (input, context) => result>`. One entry per command id. |
| `definition.execute` | Advanced: take over the whole `extension.execute` handling yourself (receives `{ command, input }`). Mutually exclusive in practice with `commands`. |
| `extension.registerCommand(name, handler)` | Register a command after construction. Throws on empty or duplicate names. |
| `extension.start()` | Begin reading JSON-RPC from stdin. **Must be called** or Mocu calls will hang until timeout. |
| `extension.llm.generate(params)` | Call the Mocu host LLM. See [llm-calls.md](llm-calls.md). |
| `extension.notify(method, params)` | Send a one-way JSON-RPC notification to the host (used for activity streaming). See [streaming-activity.md](streaming-activity.md). |

### Handler contract

- `input` — whatever the caller passed (often an object like `{ prompt }`).
  Treat it as unknown JSON; validate before use.
- `context` — an object with host-provided metadata. For streaming commands
  it contains `toolCallId` and `toolName` (see
  [streaming-activity.md](streaming-activity.md)).
- Return value may be a string, object, array — any JSON value. It is wrapped
  automatically into `{ success: true, output: ... }`.
- Throw an `Error` to return `{ success: false, error: message }`.

## Critical rule: never write to stdout

stdout is the protocol channel. Redirect logging to stderr at the top of
your entry file (as `extensions-examples/pi-node/index.js` does):

```js
console.log = (...a) => console.error(...a);
console.info = (...a) => console.error(...a);
console.debug = (...a) => console.error(...a);
```

## Calling the LLM from a helper function

`extension.llm` is just a property of the extension object — it works from
any async function after `extension.start()`, not only inside command
handlers. See the `llm-outside-example` in [examples.md](examples.md).

## Full-featured example

See `extensions-examples/pi-node` (multi-command, streaming, command
queueing) and `extensions-examples/time-node` (minimal). Catalog in
[examples.md](examples.md).

## Related documents

- Manifest fields: [manifest-reference.md](manifest-reference.md)
- Host LLM calls: [llm-calls.md](llm-calls.md)
- Streaming: [streaming-activity.md](streaming-activity.md)
- Python version: [python-sdk.md](python-sdk.md)
