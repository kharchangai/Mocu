# Mocu UI SDK

A dependency-free browser SDK for **extension app pages** running in Mocu's sandboxed iframe. It wraps the iframe `postMessage` protocol and exposes Promise-based APIs on `window.mocu`.

This is separate from `sdk-node` and `sdk-python`: those SDKs are for an extension's Node/Python command process and cannot be used by its browser UI.

## Add it to an extension

An extension app should carry its own copy of the browser SDK so its UI continues to work when installed or moved independently of Mocu's source tree.

1. Copy `install-resources/extension-system/sdk-ui/mocu-ui.js` into the extension, for example at `ui/vendor/mocu-ui.js`.
2. Load it **before** the app's other scripts in the app's HTML:

   ```html
   <script src="./vendor/mocu-ui.js"></script>
   <script>
     // Your app can now call window.mocu.*
   </script>
   ```

   For a module-based UI, load the classic script before the module script; the SDK installs a global `window.mocu` object.

The source checkout's Mocu build already bundles the full `install-resources/extension-system` directory, including `sdk-ui`. The installed extension should still vendor its own `mocu-ui.js`; it should not link to an absolute path in Mocu's app-data directory.

## APIs

```js
// Low-level request, useful for a host method not yet wrapped below.
const result = await window.mocu.request("some.host.method", { example: true });

// Invoke a command declared in this extension's manifest.
const translation = await window.mocu.extension.execute("translate", { text: "Hello" });

// Ask the user for access to a folder, then list, read, and write within the approved root.
await window.mocu.filesystem.chooseFolder({ suggestedPath: "E:\\news" });
const entries = await window.mocu.filesystem.list("");
const text = await window.mocu.filesystem.readText(entries[0].path); // returns a string
await window.mocu.filesystem.writeText("summary.txt", text.trim()); // resolves true

// Request the selected text in the app; Mocu asks the user for approval.
const selected = await window.mocu.selection.get(); // { text: string }
```

### Methods and return values

- `mocu.request(method, params?, { timeoutMs? }?)` sends a generic host request and resolves to its `result`. Default timeout: 180,000 ms. Set `timeoutMs: 0` to wait without a timeout.
- `mocu.configure({ timeoutMs })` changes the default timeout for subsequent requests.
- `mocu.extension.request(method, params?, options?)` is the extension namespace's generic request helper.
- `mocu.extension.execute(command, input?, options?)` calls a command declared in `manifest.json` and resolves to its output. It rejects if the host or command reports an error.
- `mocu.filesystem.chooseFolder({ suggestedPath?, force? }?, options?)` asks for access to a folder. `suggestedPath` only suggests a starting location; `force: true` asks to choose/replace the grant again.
- `mocu.filesystem.list(relativePath?, options?)` lists a directory within the approved folder; the empty path denotes its root.
- `mocu.filesystem.readText(relativePath, options?)` reads UTF-8 text and resolves directly to a string.
- `mocu.filesystem.writeText(relativePath, text, options?)` writes UTF-8 text inside the approved folder. It requires the manifest's `filesystem.write` permission, rejects a non-empty `relativePath` or non-string `text` before contacting the host, and resolves to `true` on success.

Every API supports an optional final request-options object `{ timeoutMs }`. Failures reject with `Error`. The SDK checks that responses came from `window.parent`, matches each reply by its unique request ID, and removes timed-out or completed requests from its pending table. Because the iframe is sandboxed with an opaque origin, requests use `postMessage(..., "*")`; do not remove the source and request-ID checks.

## Host permissions and limits

The SDK is only a convenience wrapper; it does not grant capabilities or bypass host checks. `filesystem.list`, `readText`, and `chooseFolder` require the extension's `filesystem.read` permission, and `writeText` requires `filesystem.write`. These permissions are independent: read access does not allow writing, and a write-only extension may declare just `filesystem.write` and still obtain a folder grant. `selection.get` requires `selection.read`. Commands must be declared by the extension. The host also asks the user to approve folder and selected-text access. See `../extension-app-filesystem-api.md` and `../extension-app-filesystem-write-api.md` for filesystem boundaries and limits.

## Browser usage example

```html
<script src="./vendor/mocu-ui.js"></script>
<script>
  async function loadLatestNews() {
    try {
      await window.mocu.filesystem.chooseFolder({ suggestedPath: "E:\\news" });
      const entries = await window.mocu.filesystem.list("");
      const firstTextFile = entries.find((entry) => entry.kind === "file" && entry.name.endsWith(".txt"));
      if (!firstTextFile) return;
      const articleText = await window.mocu.filesystem.readText(firstTextFile.path);
      document.querySelector("main").textContent = articleText;
      // Requires the manifest's `filesystem.write` permission.
      await window.mocu.filesystem.writeText("summary.txt", articleText.trim());
    } catch (error) {
      document.querySelector("main").textContent = error instanceof Error ? error.message : String(error);
    }
  }
</script>
```
