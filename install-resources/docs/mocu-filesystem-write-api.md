---
id: mocu-filesystem-write-api
title: Mocu Filesystem Write API
description: Explains how sandboxed Mocu extension apps obtain an approved
  folder and write text files using filesystem permissions and the app bridge.
  Retrieve this when implementing or troubleshooting extension file writes,
  folder grants, path restrictions, or the browser SDK.
keywords:
  - Mocu filesystem write
  - filesystem.write
  - filesystem.writeText
  - filesystem.chooseFolder
  - extension app file writing
  - app bridge postMessage
  - folder grant
  - manifest permissions
  - filesystem.read
  - mocu-ui.js
  - relative path security
  - extension filesystem API
---
# Mocu Filesystem Write API

## Purpose and security model

Mocu extension app pages run inside a sandboxed iframe and cannot call Tauri filesystem commands directly. To write local text files, an extension must:

1. Declare the generic `filesystem.write` permission in `manifest.json`.
2. Obtain a folder grant through Mocu’s app bridge, with the user’s approval in Mocu’s native folder picker.
3. Write files using `filesystem.writeText` and a relative path inside the approved folder.

The write permission alone does not grant access to any folder. Folder grants are scoped to the requesting extension and last for the current Mocu session.

A folder grant is not itself a read capability. A write-only extension may obtain and reuse a grant, but it cannot list or read files without `filesystem.read`. File-format parsing and presentation belong in the extension. The Rust host provides generic filesystem operations only; it does not implement format-specific or extension-specific writers.

## Manifest permissions

An extension that writes files can declare:

```json
{
  "permissions": ["filesystem.write"],
  "app": { "entry": "ui/index.html", "title": "My Editor" }
}
```

`filesystem.write` is a generic filesystem permission. It is not tied to an extension ID, file extension, or location. Do not use special-purpose permissions such as `notes.write` for filesystem access.

`filesystem.read` is separate from `filesystem.write`:

- `filesystem.read` permits `filesystem.chooseFolder`, `filesystem.list`, and `filesystem.readText`.
- `filesystem.write` permits `filesystem.writeText` and also permits the extension to request a folder grant.
- `filesystem.chooseFolder` and the host-side `extension_fs_has_grant` check accept either `filesystem.read` or `filesystem.write`.
- An extension that only writes can declare only `filesystem.write`. It may obtain and reuse a folder grant, but `filesystem.list` and `filesystem.readText` are still rejected without `filesystem.read`.
- `filesystem.writeText` independently requires `filesystem.write`.

The Rust host verifies each filesystem operation against the installed extension manifest. A folder grant does not bypass these per-operation permission checks.

## App bridge request and response protocol

Send requests from the iframe to its parent with a `mocu:request` message. For example:

```js
window.parent.postMessage({
  type: "mocu:request",
  requestId: "unique-request-id",
  method: "filesystem.writeText",
  params: { relativePath: "notes/todo.txt", text: "- buy milk\n" }
}, "*");
```

A `filesystem.writeText` request has parameters shaped as `{ relativePath: string, text: string }`.

Replies have the shape `{ type: "mocu:response", requestId, result }`, or the same shape with an `error` string. After a successful write, the bridge returns `{ written: true }`.

When handling responses:

- Check that `event.source === window.parent`.
- Match the response’s `requestId` to the original request.
- Resolve or reject only the matching pending request.

## Available filesystem methods

- **`filesystem.chooseFolder`** — Shows a consent prompt and native folder picker. Optional parameters are `{ suggestedPath?: string, force?: boolean }`. Use `force: true` to choose or replace a previous grant. Accepts an extension with either `filesystem.read` or `filesystem.write`; resolves with `{ granted: true, rootPath: "" }`.
- **`filesystem.list`** — Lists a directory inside the approved root. Requires `filesystem.read`.
- **`filesystem.readText`** — Reads a UTF-8 text file inside the approved root. Requires `filesystem.read`.
- **`filesystem.writeText`** — Writes a UTF-8 text file inside the approved root. Requires `filesystem.write`.

## Path and write limits

The target must be a file path relative to the user-approved folder. Forward slashes and backslashes are accepted as separators. The parent folder of the target must already exist; Mocu does not create directories.

Mocu rejects:

- Empty paths and absolute paths.
- Drive paths or drive letters, such as `C:/...`.
- Paths containing `..` traversal.
- Paths that resolve outside the approved folder.
- A pre-existing symlink when it points outside the approved folder.
- A path that refers to a folder, with the error: `"The requested path is a folder, not a file."`

Each call is limited to 2 MiB of text.

## Browser SDK

Vendor `install-resources/extension-system/sdk-ui/mocu-ui.js` into the extension and load it before the app scripts. The SDK exposes `window.mocu.filesystem.writeText(relativePath, text, options?)` as a convenience wrapper:

```js
await window.mocu.filesystem.chooseFolder({ suggestedPath: "E:\\notes" });
await window.mocu.filesystem.writeText("todo.txt", "- buy milk\n"); // resolves true
```

`mocu.filesystem.writeText(relativePath, text, options?)` validates both arguments, sends a `filesystem.writeText` request, and resolves to `true`. It rejects with an `Error` if the host operation or host permission check fails. The raw bridge response after a successful write is `{ written: true }`.

For generic bridge requests, use `mocu.filesystem.request("filesystem.writeText", params, options)`.

## Raw bridge example

```js
const pending = new Map();
let nextId = 0;

function request(method, params = {}) {
  const requestId = `fs-${++nextId}`;
  window.parent.postMessage({ type: "mocu:request", requestId, method, params }, "*");
  return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent || event.data?.type !== "mocu:response") return;
  const item = pending.get(event.data.requestId);
  if (!item) return;
  pending.delete(event.data.requestId);
  if (event.data.error) item.reject(new Error(event.data.error));
  else item.resolve(event.data.result);
});

await request("filesystem.chooseFolder", { suggestedPath: "E:\\notes" });
const { written } = await request("filesystem.writeText", {
  relativePath: "todo.txt",
  text: "- buy milk\n",
});
console.log(written); // true
```

## Rust host implementation

The host exposes `extension_fs_write` in `src-tauri/src/extension_host/mod.rs` and registers it in `src-tauri/src/lib.rs`. It verifies the installed manifest permission with `verify_filesystem_permission`, resolves the destination with `resolve_write_target`, and writes the text using `std::fs::write`. Folder-grant checks accept either `filesystem.read` or `filesystem.write`; each read or write operation still requires its own corresponding permission.

## When to use this document

Retrieve this document when implementing or debugging local text-file writes from a Mocu extension, configuring `filesystem.write` or `filesystem.read` in a manifest, requesting or reusing a user-approved folder, using the app bridge or browser SDK, or checking path, symlink, size, permission, and session-grant restrictions.
