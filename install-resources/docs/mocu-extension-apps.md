# Mocu Extension App UI (first version)

An extension may optionally provide a small HTML UI to show in Mocu's **App** sidebar page. The UI lives in the extension directory and is rendered inside a sandboxed iframe. Extensions without an `app` field continue to work as before.

## Manifest

Add the optional `app` block. Its `entry` is a relative path to an HTML file inside the installed extension folder; absolute paths, URL schemes, `.` and `..` path segments are rejected.

```json
{
  "id": "com.example.dashboard",
  "name": "Dashboard",
  "description": "A UI extension",
  "version": "1.0.0",
  "runtime": "node",
  "entry": "index.js",
  "permissions": ["selection.read"],
  "commands": [],
  "app": {
    "entry": "ui/index.html",
    "title": "Dashboard"
  }
}
```

Only installed extensions with a valid `app.entry` are listed in the App page. Mocu resolves the path on the Rust side, canonicalizes it, verifies it remains within the extension directory, and authorizes only the app page's asset directory for Tauri's asset protocol.

## `selection.get()` bridge

The iframe has no direct access to Mocu's privileged frontend APIs, files, or extension-process stdin/stdout. A UI may call the limited promise-based API:

```js
const { text } = await window.mocu.selection.get();
```

For this first version, the UI implements the JSON `postMessage` bridge itself:

- request: `{ type: "mocu:request", requestId: "...", method: "selection.get", params: { selectedText: "..." } }`
- response: `{ type: "mocu:response", requestId: "...", result: { text: "..." } }`
- failure: `{ type: "mocu:response", requestId: "...", error: "..." }`

The parent verifies `event.source` is the app iframe. It only accepts `selection.get`, requires the extension's `selection.read` manifest permission, then shows a user approval prompt for each request. The app supplies the proposed selected text; Mocu shows a preview and returns it only after approval, limited to 20,000 characters. Cancel returns an error. The bridge deliberately does not expose arbitrary Mocu page selection or privileged APIs. Do not add `allow-same-origin` or other iframe sandbox privileges without an explicit security review.

See `install-resources/extensions-default/app-ui-demo` for a runnable starter page. Its UI is intentionally decoupled from the Node/Python JSON-RPC process; future app-to-extension commands should go through a separately validated host bridge.
