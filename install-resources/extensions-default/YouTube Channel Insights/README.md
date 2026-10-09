# YouTube Channel Insights — Mocu extension

Starter skeleton for a Mocu extension.

## Structure

```
mocu-extension/
├── manifest.json              # Extension metadata and command declarations
├── package.json               # Node package (ESM) and dependencies
├── index.js                   # Entry point: registers command handlers and starts the SDK
├── src/
│   └── commands/              # One file per command handler
│       └── example-echo.js    # Placeholder command
├── test/
│   └── manifest.test.js       # Basic manifest checks
└── vendor/
    ├── extension-sdk/         # Local copy of @mocu/extension-sdk
    └── extension-contracts/   # Local copy of @mocu/extension-contracts
```

## Adding a new command

1. Create a handler in `src/commands/<name>.js`:
   ```js
   export async function myCommand(input, context, config) {
     return { ok: true };
   }
   ```
2. Add the command to the `commands` array in `manifest.json` (the `id` must be unique).
3. Register it in `index.js` under the same name as its `id`:
   ```js
   commands: {
     async my_command(input, context, config) {
       return myCommand(input, context, config);
     },
   },
   ```

## Important notes

- **stdout is reserved** for Mocu's JSON-RPC protocol. `index.js` redirects `console.log/info/debug` to stderr; use `console.error` for logs.
- Do not include `node_modules` when zipping the extension for installation.
- Zip the folder so `manifest.json` is at the ZIP root (or one folder below it), then install it in Mocu under **Extensions**.

## Local development

```powershell
npm install
npm test
node index.js
```

`node index.js` should wait quietly for JSON-RPC input from Mocu.
