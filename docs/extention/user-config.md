# Asking the User for Extension Settings (`config`)

**Search keywords:** config, user input, settings, api key, url, token,
form, extension settings, configuration, required, default, password,
secret, manifest config, user fills in, extension page settings, per
extension settings

An extension can **ask the user for input** — an API key, a base URL, a
username, any value it needs. The user does not edit your code: you declare
the inputs in the manifest's `config` array, and Mocu renders a **Settings
form on the extension's card** in the Extensions page. Whatever the user
fills in is delivered to your handlers with **every** command call.

## Declaring settings in the manifest

```json
{
  "id": "com.example.weather",
  "name": "Weather",
  "description": "Weather lookups via a custom provider.",
  "version": "1.0.0",
  "runtime": "node",
  "entry": "index.js",
  "commands": [
    {
      "id": "current",
      "title": "Current weather",
      "description": "Returns current weather for a city."
    }
  ],
  "config": [
    {
      "key": "apiKey",
      "label": "Weather API key",
      "type": "password",
      "required": true,
      "description": "Get one at weatherprovider.com/keys"
    },
    {
      "key": "baseUrl",
      "label": "Provider base URL",
      "type": "string",
      "default": "https://api.weatherprovider.com/v1",
      "placeholder": "https://api.weatherprovider.com/v1"
    },
    {
      "key": "units",
      "label": "Units",
      "type": "string",
      "default": "metric"
    },
    {
      "key": "cacheMinutes",
      "label": "Cache minutes",
      "type": "number",
      "default": 15
    }
  ]
}
```

## Field reference (`config[]`)

| Field | Type | Meaning |
|-------|------|---------|
| `key` | string | Required. Key the value is delivered under in your `config` object. |
| `label` | string | Required. Human-readable label shown in the form. |
| `description` | string | Helper text below the input (where to get a key, formats, ...). |
| `type` | string | `"string"` (default), `"number"`, `"boolean"` (checkbox), or `"password"` (masked input — use for API keys/tokens). |
| `required` | bool | The form refuses to save when empty. |
| `default` | string / number / bool | Used when the user has not filled anything in. |
| `placeholder` | string | Placeholder text inside the empty input. |

## How the values reach your extension

Every `extension.execute` call carries a `config` param — the user's saved
values merged with your declared `default`s (missing values arrive as `""`,
so you can detect "not configured"):

```json
{ "jsonrpc": "2.0", "id": "uuid", "method": "extension.execute",
  "params": { "command": "current",
              "input": { "city": "Tehran" },
              "config": { "apiKey": "•••", "baseUrl": "https://...",
                          "units": "metric", "cacheMinutes": 15 } } }
```

Both SDKs hand it to your handler as the **third argument**:

```js
// Node
const extension = createExtension({
  commands: {
    async current(input, context, config) {
      if (!config.apiKey) {
        throw new Error(
          "Weather API key is not set. Open Extensions → Weather → Settings.",
        );
      }

      const response = await fetch(
        `${config.baseUrl}/weather?units=${config.units}&key=${config.apiKey}`,
      );

      return await response.json();
    },
  },
});

extension.start();
```

```python
# Python
@extension.command("current")
def current(input_value, context, config):
    if not config.get("apiKey"):
        raise Exception(
            "Weather API key is not set. Open Extensions → Weather → Settings."
        )

    # ... use config["baseUrl"], config["units"], config["apiKey"] ...
```

## Rules and gotchas

- **Where settings live**: values are saved per extension id in Mocu's
  settings store (`settings.json`, key `MOCU_EXTENSION_CONFIG`) — they
  survive restarts and reinstalls at the same id.
- **Values are sent fresh on every command call** — no caching inside your
  extension is needed; after the user saves new settings the very next
  command uses them (running processes included).
- **Secrets**: use `"type": "password"` so the input is masked. Treat all
  config values as sensitive — never log them, never echo them back in
  output.
- **Empty means unset**: a field without a default arrives as `""` when the
  user has not filled it in. Check for it and fail with a message that
  tells the user *where* to enter the value.
- **Numbers** arrive as JSON numbers, **booleans** as real booleans;
  everything else is a string.
- Config declaration is read from the manifest at scan time — ship a new
  manifest version (reinstall) to add or change fields.

## Related documents

- Manifest field reference: [manifest-reference.md](manifest-reference.md)
- Node SDK handler signature: [node-sdk.md](node-sdk.md)
- Python SDK handler signature: [python-sdk.md](python-sdk.md)
