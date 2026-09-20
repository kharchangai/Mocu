# Examples Catalog, Recipes and Troubleshooting

**Search keywords:** examples, extensions-examples, time-node, sysinfo-node,
hi-llm-node, llm-outside-example, pi-node, test, cookbook, recipes,
troubleshooting, faq, not responding, hangs, no output, invalid json,
unknown command, timeout, corrupted stdout, debug, logs, stderr

## Example catalog (`extensions-examples/`)

| Example | What it demonstrates |
|---------|----------------------|
| `time-node` | **Hello-world.** Minimal Node SDK extension; one `time` command returning current time + response latency. Start here. |
| `sysinfo-node` | Minimal Node extension returning OS/CPU/memory details via `node:os`. Shows structured multi-line text output. |
| `hi-llm-node` | First LLM call: the `hi` command asks the host LLM to reply and returns `result.text`. |
| `llm-outside-example` | Proof that `extension.llm.generate()` works from a **standalone helper function**, not only inside a command handler. |
| `pi-node` | **Advanced.** Multi-command extension embedding a pi coding-agent session: `ask` / `reset` / `status`, streaming activity notifications with buffering/throttling, command queueing, console.log → stderr redirection, long timeout (`timeoutSeconds: 900`). |
| `test` | Bare-bones extension (no SDK) — useful to see the protocol minimalism. |

Each example folder contains `manifest.json`, `package.json` and `index.js`.

## Recipe: text command with input

```js
import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    greet(input) {
      const name = input?.name ?? "friend";
      return `Hi ${name}!`;
    },
  },
});
extension.start();
```

Manifest command: `{ "id": "greet", "title": "Greet", "description": "Greets by name. Input: { name }." }`

## Recipe: returning structured data

Return any JSON value — objects/arrays are preserved:

```js
weather(input) {
  return { city: input?.city, tempC: 21, forecast: ["sunny", "cloudy"] };
}
```

## Recipe: asking the user for settings (API key / URL)

Declare the inputs in the manifest and read the third handler argument:

```js
const extension = createExtension({
  commands: {
    async current(input, context, config) {
      if (!config.apiKey) {
        throw new Error("API key not set — open Extensions → Weather → Settings.");
      }

      return await fetchWeather(config.baseUrl, config.apiKey, input?.city);
    },
  },
});
extension.start();
```

Full field reference: [user-config.md](user-config.md).

## Recipe: long-running command with progress

Use `streaming: true` + `extension.notify` — see
[streaming-activity.md](streaming-activity.md) and `pi-node`.

## Troubleshooting / FAQ

**Extension hangs / command times out (default 900 s)**
- Did you call `extension.start()` (Node) or `extension.run()` (Python)?
- Is the manifest `entry` correct and the file present?
- Any dependency not installed? (Node: the installer runs `npm install`;
  Python: you must arrange imports yourself.)

**"Unknown command: X"**
- The `command` sent by Mocu must equal a registered handler name
  **and** ideally a `commands[].id` in the manifest. Register a handler for
  every id you declare.

**Nothing happens / protocol corruption**
- Something wrote to **stdout** (a `console.log`, a library banner, a
  `print()`). Redirect logs to stderr. stdout is for JSON-RPC only.

**Invalid manifest errors at install**
- Check id format (reverse-domain, lowercase, separator required), semver
  version, runtime value, safe relative entry path —
  [manifest-reference.md](manifest-reference.md).

**LLM call fails**
- The host LLM needs the user's configured provider/API key; handle the
  rejection and return a friendly error. See [llm-calls.md](llm-calls.md).

**Decision / embedding call fails**
- The Jev decision model needs the Decision API key and the embedding model
  needs the Embedding settings in Mocu Settings; both fail with a clear
  error when unset. See [decision-model.md](decision-model.md) /
  [embedding-model.md](embedding-model.md).

**Extension settings (config values) empty / command says "not configured"**
- Open the Extensions page → find the extension's card → **Settings** →
  fill in the values and save. New values are used by the very next command
  call. See [user-config.md](user-config.md).

**Extension state lost**
- Processes can be restarted (e.g. reinstall at a new path). Persist state
  to disk inside your extension folder instead of relying on memory.

**Debugging locally**
- Run the entry manually: `node index.js` / `python main.py` — it should
  start and wait silently (it is waiting for JSON-RPC on stdin).
- Anything you write to stderr is visible in Mocu's logs / terminal, and is
  never parsed as protocol.

## Related documents

- [architecture.md](architecture.md) · [node-sdk.md](node-sdk.md) ·
  [python-sdk.md](python-sdk.md) · [installation.md](installation.md) ·
  [agent-guide.md](agent-guide.md)
