# Building a Python Extension (`mocu_extension_sdk`)

**Search keywords:** python extension, mocu_extension_sdk, pip, pyproject,
create_extension, @command decorator, register_command, run, main.py,
async def, await, event loop, asyncio, tutorial, example, print stdout,
stderr, requires-python, snake_case, camelCase

## Project layout

```
my-extension/
├── manifest.json      <- runtime: "python", entry: "main.py"
├── main.py
└── pyproject.toml     (optional, if you need dependencies)
```

## Minimal extension

```python
# main.py
from mocu_extension_sdk import create_extension

extension = create_extension()

@extension.command("hello")
def hello(input_value, context):
    name = (input_value or {}).get("name", "world") if isinstance(input_value, dict) else "world"
    return f"Hello, {name}!"

if __name__ == "__main__":
    extension.run()   # start the stdin JSON-RPC loop — required!
```

`manifest.json`:

```json
{
  "id": "com.example.my-python-ext",
  "name": "My Python Extension",
  "description": "Greets the user.",
  "version": "1.0.0",
  "runtime": "python",
  "entry": "main.py",
  "engines": { "python": ">=3.10" },
  "commands": [
    { "id": "hello", "title": "Say hello", "description": "Returns a greeting." }
  ]
}
```

## SDK API

| Member | Description |
|--------|-------------|
| `create_extension()` | Returns a new `MocuExtension`. |
| `@extension.command(name)` | Decorator registering a command handler. Throws on empty name or duplicates. |
| `extension.register_command(name, handler)` | Programmatic registration (same rules). |
| `extension.run()` | Start the blocking stdin JSON-RPC loop. **Must be called.** |
| `extension.llm.generate(prompt, *, system_prompt=None, temperature=None, max_tokens=None)` | Call the Mocu host LLM. Returns `{"text": ...}`. Note the **snake_case** keyword arguments; the SDK converts them to camelCase on the wire. See [llm-calls.md](llm-calls.md). |

### Handler contract

- Handler signature: `handler(input, context)`.
  - `input` — the caller-supplied JSON value (often a dict).
  - `context` — a dict of host-provided metadata (empty dict if absent).
- May be sync or async (`async def`); the SDK awaits coroutines.
- Return value (any JSON value) is wrapped into `{"success": True, "output": ...}`.
- Raise an exception to return `{"success": False, "error": str(error)}`.

## Critical rules

- **Never `print()` to stdout** — stdout is the protocol channel and any
  stray output corrupts JSON-RPC. Write logs with `print(..., file=sys.stderr)`
  or `logging` configured to stderr.
- The host runs the entry with `python` (Windows) or `python3` (Unix), so the
  interpreter must be on PATH and your dependencies must be importable.
  Keep pure-standard-library extensions simplest, or vendor dependencies
  inside the extension folder.

## Dependencies

Declare them in a `pyproject.toml` inside the extension folder:

```toml
[project]
name = "my-extension"
version = "1.0.0"
requires-python = ">=3.10"
dependencies = ["requests>=2.31"]
```

Note: unlike Node extensions, the installer does **not** automatically run
`pip install` — see [installation.md](installation.md). Document any setup
step in the extension description or have your extension fail with a clear
error message.

## Current limitations vs the Node SDK

- No `extension.notify` / activity streaming support yet in the Python SDK
  (streaming commands are a Node-SDK feature for now). See
  [streaming-activity.md](streaming-activity.md).

## Related documents

- Manifest fields: [manifest-reference.md](manifest-reference.md)
- Wire protocol: [protocol-reference.md](protocol-reference.md)
- Node SDK: [node-sdk.md](node-sdk.md)
