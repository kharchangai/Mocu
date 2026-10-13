# Extension App Filesystem API

Extension app pages run in a sandboxed iframe and cannot call Tauri filesystem commands directly. To read local text files, an app must declare the generic `filesystem.read` permission and request folder access through Mocu's app bridge. Mocu opens a native folder picker and only exposes the directory selected by the user.

## Manifest

```json
{
  "permissions": ["filesystem.read"],
  "app": { "entry": "ui/index.html", "title": "My Reader" }
}
```

This permission is generic, not tied to an extension ID, content type, or location. Avoid special-purpose permissions such as `news.read` for filesystem access.

## Request and response protocol

Send requests from the iframe to its parent:

```js
window.parent.postMessage({
  type: "mocu:request",
  requestId: "unique-request-id",
  method: "filesystem.chooseFolder",
  params: { suggestedPath: "E:\\news", force: true }
}, "*");
```

The `suggestedPath` is only a starting-location hint; it does not give access by itself. The user chooses the folder. Replies use `{ type: "mocu:response", requestId, result }` or the same shape with an `error` string. When receiving messages, check `event.source === window.parent` and resolve only the matching request ID.

### Available methods

- `filesystem.chooseFolder` — shows a consent prompt and native folder picker. Optional parameters: `{ suggestedPath?: string, force?: boolean }`. Set `force: true` to choose or replace a prior grant. Resolves with `{ granted: true, rootPath: "" }`. The approved folder becomes the app's virtual root.
- `filesystem.list` — lists a directory within the approved root. Parameters: `{ relativePath?: string }`; an empty path refers to the root. Resolves to entries shaped as `{ name, path, kind, size }`, where `kind` is `directory` or `file` and `size` is nullable.
- `filesystem.readText` — reads a UTF-8 text file within the approved root. Parameters: `{ relativePath: string }`. Resolves with `{ text: string }`.

Use a path returned by `filesystem.list` as the `relativePath` for subsequent calls. Absolute paths and `..` traversal are rejected, and symlinks resolving outside the chosen folder are not followed. Each listing is limited to 2,000 entries; each text read is limited to 2 MiB. Folder grants last for the current Mocu session and are scoped to the requesting extension.

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
await request("filesystem.chooseFolder", { suggestedPath: "E:\\news", force: true });
const rootEntries = await request("filesystem.list", { relativePath: "" });
const textFile = rootEntries.find((entry) => entry.kind === "file" && entry.name.endsWith(".txt"));
if (textFile) {
  const { text } = await request("filesystem.readText", { relativePath: textFile.path });
  console.log(text);
}
```

Keep file-format parsing and presentation in the extension. The Rust host should implement only these generic, read-only operations—never a format-specific or extension-specific reader.
