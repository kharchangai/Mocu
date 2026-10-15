---
id: mocu-extension-app-ui
title: Mocu Extension App UI
description: Explains how to build an HTML app in Mocu’s App sidebar, including
  manifest setup, sandbox security, browser APIs, filesystem permissions, and
  saved-agent access. Retrieve it when developing or troubleshooting an in-Mocu
  extension UI.
keywords:
  - Mocu Extension App UI
  - Mocu sidebar app
  - extension app manifest
  - app entry
  - sandboxed iframe
  - Mocu UI SDK
  - window.mocu
  - extension.execute
  - saved agents
  - agents.invoke
  - extension permissions
  - app-ui-demo
  - filesystem.write
  - writeText
  - Mocu Filesystem Write API
---
# Mocu Extension App UI

## User flow and manifest

Mocu’s **App** sidebar page lists installed extensions whose manifest contains a valid optional `app` object. The user opens an app inside Mocu; it is not opened in a separate browser or window.

The `app` object requires a relative `entry` path to the app’s HTML file. It may also include an optional `title`. The entry must resolve to a file inside the installed extension folder. Mocu rejects paths that traverse outside that folder, absolute or drive paths, paths with a URL query or hash, and paths that do not resolve to files.

The app’s HTML entry is separate from the extension’s Node or Python runtime `entry`. An extension can have both entries and can also declare commands for its UI to invoke.

```json
{
  "id": "com.example.my-app",
  "name": "My App",
  "description": "An in-Mocu extension app.",
  "version": "1.0.0",
  "runtime": "node",
  "entry": "index.js",
  "permissions": [],
  "commands": [],
  "app": { "entry": "ui/index.html", "title": "My App" }
}
```

Here, `index.js` is the Node runtime entry and `ui/index.html` is the app UI entry. If the UI calls a command such as `hello`, declare that command in the manifest and implement its handler in the runtime.

## Security boundary and browser SDK

Mocu hosts the HTML UI in a sandboxed iframe with `allow-scripts allow-forms` and **without** `allow-same-origin`. The UI cannot call Tauri directly and does not receive blanket filesystem access.

The UI communicates with Mocu through a `postMessage` bridge. For browser-side API calls, vendor the dependency-free SDK at `install-resources/extension-system/sdk-ui/mocu-ui.js` into the extension—for example, as `ui/vendor/mocu-ui.js`—and load it before your app scripts. Each installed app must include its own SDK copy; do not depend on an absolute path inside Mocu’s global app-data.

The browser SDK exposes `window.mocu` APIs subject to permissions and user authorization:

- `window.mocu.extension.execute(command, input)` invokes a command declared by the extension.
- `window.mocu.selection.get()` requires the `selection.read` permission and user approval.
- `window.mocu.filesystem.chooseFolder()`, `list()`, and `readText()` require `filesystem.read`.
- `window.mocu.filesystem.writeText(relativePath, text)` requires `filesystem.write`. It writes a UTF-8 text file inside the folder approved for the requesting extension and resolves to `true`.

If implementing the bridge with raw `postMessage`, verify `event.source` and match responses using request IDs. Render untrusted output as text rather than HTML, and catch rejected API calls.

## App UI filesystem access

Filesystem access is scoped to one folder that the user explicitly approves for the requesting extension. Folder grants last for the current Mocu session. Read and write permissions are separate:

- `filesystem.read` permits the read APIs, including `chooseFolder()`, `list()`, and `readText()`.
- `filesystem.write` permits `writeText()`. Read permission does not imply write access, and write permission does not allow listing or reading.
- An extension that only writes can declare just `filesystem.write` and still request a folder grant.

`writeText(relativePath, text)` has these constraints:

- The target must be a relative path that stays inside the approved folder and identifies a file, not a folder.
- The parent folder must already exist; the API does not create it.
- Writes are limited to 2 MiB of text and use UTF-8.
- Symlinks pointing outside the approved folder are not followed.

For the complete method list, parameters, limits, and security boundaries, see **Mocu Filesystem Write API**.

## Minimal UI example

This page loads the vendored SDK before the app script, invokes the declared `hello` command, and displays the result using `textContent`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My App</title>
  </head>
  <body>
    <button id="run">Say hello</button>
    <pre id="output"></pre>

    <script src="./vendor/mocu-ui.js"></script>
    <script>
      const output = document.querySelector("#output");

      document.querySelector("#run").addEventListener("click", async () => {
        try {
          const result = await window.mocu.extension.execute("hello", {
            name: "Mocu"
          });
          output.textContent = JSON.stringify(result);
        } catch (error) {
          output.textContent = `Error: ${error.message}`;
        }
      });
    </script>
  </body>
</html>
```

The extension must declare `hello` in its manifest’s `commands` and provide a matching runtime handler for this example to work.

## Using saved agents from an App

Browser UI code should not assume direct access to agent APIs. To use a saved agent, have the UI call a declared backend extension command with `window.mocu.extension.execute`; the command’s Node or Python handler then uses the backend agents SDK.

Add `agents.invoke` to the extension manifest’s permissions. The backend SDK provides:

- **Node:** `extension.agents.list()` and `extension.agents.run({agentId, input})`
- **Python:** `extension.agents.list()` and `extension.agents.run(agent_id, input)`

`list()` returns agent descriptors containing only `{id, name, description}`. `run()` returns `{agentId, name, text}`. Invoking an agent runs an existing saved agent; it does not create one. Agent creation happens in Mocu’s Agents page or through the chat agent-creation flow.

For related concepts, see **Mocu Extension Development** and **Mocu Agents**.

## Examples and SDK guide

Use the shipped examples as implementation references:

- `install-resources/extensions-default/app-ui-demo`
- `install-resources/extensions-default/txt-reader-app`

The verified browser SDK guide is `install-resources/extension-system/sdk-ui/README.md`.

## When to use this document

Retrieve this guide when building, reviewing, or debugging an HTML interface that runs in Mocu’s App sidebar; configuring an extension’s `app` manifest entry; using the browser UI bridge; granting folder-scoped filesystem read or write access; using `writeText()` safely; or connecting an App UI to declared commands and saved agents.
