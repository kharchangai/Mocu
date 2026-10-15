# Extension App Filesystem Write API

Extension app pages run in a sandboxed iframe and cannot call Tauri filesystem commands directly. To write local text files, an app must declare the generic `filesystem.write` permission and write through Mocu's app bridge. Writes are limited to a single folder that the user has explicitly approved for that extension.

This is the write half of the app filesystem bridge. The read methods (`chooseFolder`, `list`, `readText`) are documented in `extension-app-filesystem-api.md`.

## Manifest

```json
{
  "permissions": ["filesystem.write"],
  "app": { "entry": "ui/index.html", "title": "My Editor" }
}
```

This permission is generic, not tied to an extension ID, content type, or location. Avoid special-purpose permissions such as `notes.write` for filesystem access.

The permission is distinct from `filesystem.read`:

- `filesystem.read` allows `filesystem.chooseFolder`, `filesystem.list`, and `filesystem.readText`.
- `filesystem.write` allows `filesystem.writeText` and also lets the extension request a folder grant.
- An extension that writes but never reads can declare only `filesystem.write`. It may still obtain a folder grant, but `filesystem.list` and `filesystem.readText` will be rejected because `filesystem.read` is not declared.

A folder grant authorizes the folder, not the operation. Every following call is still checked against its own permission, so an extension with both permissions may list, read, and write inside the same folder.

## Request and response protocol

Send requests from the iframe to its parent:

```js
window.parent.postMessage({
  type: "mocu:request",
  requestId: "unique-request-id",
  method: "filesystem.writeText",
  params: { relativePath: "notes/todo.txt", text: "- buy milk\n" }
}, "*");
```

Parameters are `{ relativePath: string, text: string }`. `relativePath` must be a relative path inside the approved folder, using forward or backslash separators. Absolute paths, drive paths, `..` traversal, and empty paths are rejected. The parent folder of the target must already exist; Mocu does not create directories.

Replies use `{ type: "mocu:response", requestId, result }` or the same shape with an `error` string. A successful write resolves with `{ written: true }`. When receiving messages, check `event.source === window.parent` and resolve only the matching request ID.

### Available methods

- `filesystem.chooseFolder` — shows a consent prompt and a native folder picker. Optional parameters `{ suggestedPath?: string, force?: boolean }`. Set `force: true` to choose or replace a prior grant. Resolves with `{ granted: true, rootPath: "" }`.
- `filesystem.list` — lists a directory within the approved root. Requires `filesystem.read`.
- `filesystem.readText` — reads a UTF-8 text file within the approved root. Requires `filesystem.read`.
- `filesystem.writeText` — writes a UTF-8 text file inside the approved root. Requires `filesystem.write`.

## Limits and security boundaries

- The write is limited to 2 MiB of text per call.
- Absolute paths, drive letters such as `C:/...`, `..` traversal, and paths that resolve outside the approved folder are rejected.
- A pre-existing symlink is not followed when it points outside the approved folder.
- Writing a path that is a folder is rejected with "The requested path is a folder, not a file."
- The parent folder of the target must already exist.
- Folder grants last for the current Mocu session and are scoped to the requesting extension.
- The user approves every new folder grant through Mocu's native folder picker. The write permission alone never grants folder access.

Keep file-format parsing and presentation in the extension. The Rust host should implement only these generic, write-text operations—never a format-specific or extension-specific writer.

## Browser SDK usage

Vendor `sdk-ui/mocu-ui.js` into the extension and load it before the app scripts:

```js
await window.mocu.filesystem.chooseFolder({ suggestedPath: "E:\\notes" });
await window.mocu.filesystem.writeText("todo.txt", "- buy milk\n"); // resolves true
```

`mocu.filesystem.writeText(relativePath, text, options?)` validates both arguments locally, sends `filesystem.writeText`, and resolves to `true`. It rejects with `Error` if the host permission check or the write fails. `mocu.filesystem.request("filesystem.writeText", params, options)` is the generic equivalent.

## Example

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

The host exposes the `extension_fs_write` Tauri command, registered in `src-tauri/src/lib.rs` and implemented in `src-tauri/src/extension_host/mod.rs`:

- `verify_filesystem_permission(..., "filesystem.write")` rejects manifests that only declare `filesystem.read`.
- `extension_fs_grant` uses `verify_filesystem_folder_permission`, which accepts either permission, because a folder grant alone does not authorize an operation.
- `resolve_write_target` canonicalizes the parent folder, rejects traversal and absolute paths, and refuses a symlink that points outside the approved folder.
- The write itself uses `std::fs::write`.
