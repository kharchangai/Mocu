import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, FileCode2 } from "lucide-react";
import type { ExtensionManifest } from "../types/extension";

import "./extension-apps.css";

type AppLaunchItem = {
  extensionId: string;
  extensionName: string;
  title: string;
  extensionPath: string;
  permissions: string[];
  description: string;
  manifest: ExtensionManifest;
};

type AppListing = {
  path: string;
  manifest: ExtensionManifest;
};

type PendingSelectionRequest = { requestId: string; selectedText: string };
type PendingFolderRequest = { requestId: string; suggestedPath?: string };
type AppMessage = Record<string, unknown>;

const SELECTION_PERMISSION = "selection.read";
const FILESYSTEM_READ_PERMISSION = "filesystem.read";
const FILESYSTEM_WRITE_PERMISSION = "filesystem.write";
// Granting a folder and using it are separate checks: either filesystem
// permission may request the folder; each call is still verified against the
// manifests declared read or write permission.
const FILESYSTEM_FOLDER_PERMISSIONS = [FILESYSTEM_READ_PERMISSION, FILESYSTEM_WRITE_PERMISSION];
const MAX_SELECTION_LENGTH = 20_000;

type FsEntry = { name: string; path: string; kind: "directory" | "file"; size: number | null };

// `convertFileSrc` percent-encodes the entire file path into ONE URL segment
// (slashes become %2F), so a relative link inside the page such as
// `<script src="./testtime.js">` resolves against the host root instead of the
// page's folder and 404s. Rebuild the URL with one encoded segment per path
// component so sibling files in the extension's ui folder resolve correctly.
const toAssetUrl = (filePath: string): string => {
  const converted = convertFileSrc(filePath);
  const authorityEnd = converted.indexOf("/", converted.indexOf("//") + 2);
  const origin = authorityEnd === -1 ? converted : converted.slice(0, authorityEnd);
  const normalized = filePath
    .replace(/^[\\/]{2}\?[\\/]/, "") // strip the Windows \\?\ canonical prefix
    .replace(/\\/g, "/");
  const segments = normalized.split("/").map(encodeURIComponent).join("/");
  // The asset handler drops exactly one leading slash before decoding, so a
  // POSIX root has to travel inside the first segment (`/%2FUsers/...`).
  const path = normalized.startsWith("/") ? `%2F${segments.slice(1)}` : segments;
  return `${origin}/${path}`;
};

export function ExtensionAppsPage() {
  const [apps, setApps] = useState<AppLaunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppLaunchItem | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [selectionResult, setSelectionResult] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelectionRequest | null>(null);
  const [pendingFolder, setPendingFolder] = useState<PendingFolderRequest | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadApps = async () => {
      setLoading(true);
      setError(null);
      try {
        const listings = await invoke<AppListing[]>("extension_list_apps");
        if (!cancelled) {
          setApps(listings.flatMap(({ path, manifest }) => manifest.app ? [{
            extensionId: manifest.id,
            extensionName: manifest.name,
            title: manifest.app.title?.trim() || manifest.name,
            extensionPath: path,
            permissions: manifest.permissions ?? [],
            description: manifest.description,
            manifest,
          }] : []));
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadApps();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!selectedApp || !appUrl || !iframe) return;

    const reply = (requestId: string, result?: unknown, errorMessage?: string) => {
      iframe.contentWindow?.postMessage({
        type: "mocu:response",
        requestId,
        ...(errorMessage ? { error: errorMessage } : { result }),
      }, "*");
    };

    const handleAppMessage = async (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.contentWindow || !event.data || typeof event.data !== "object") return;
      const message = event.data as AppMessage;
      if (message.type !== "mocu:request" || typeof message.requestId !== "string") return;
      const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
        ? message.params as Record<string, unknown>
        : {};

      if (message.method === "selection.get") {
        if (!selectedApp.permissions.includes(SELECTION_PERMISSION)) {
          reply(message.requestId, undefined, `This app has not declared the '${SELECTION_PERMISSION}' permission.`);
          return;
        }
        if (pendingSelection || pendingFolder) {
          reply(message.requestId, undefined, "Another permission request is already awaiting your approval.");
          return;
        }
        setPendingSelection({
          requestId: message.requestId,
          selectedText: typeof params.selectedText === "string" ? params.selectedText.slice(0, MAX_SELECTION_LENGTH) : "",
        });
        return;
      }

      if (message.method === "filesystem.chooseFolder") {
        const canChooseFolder = FILESYSTEM_FOLDER_PERMISSIONS.some((permission) =>
          selectedApp.permissions.includes(permission)
        );
        if (!canChooseFolder) {
          reply(message.requestId, undefined, `This app has not declared the '${FILESYSTEM_READ_PERMISSION}' or '${FILESYSTEM_WRITE_PERMISSION}' permission.`);
          return;
        }
        if (pendingSelection || pendingFolder) {
          reply(message.requestId, undefined, "Another permission request is already awaiting your approval.");
          return;
        }
        try {
          const isGranted = await invoke<boolean>("extension_fs_has_grant", { extensionId: selectedApp.extensionId });
          if (params.force !== true && isGranted) {
            reply(message.requestId, { granted: true, rootPath: "" });
          } else setPendingFolder({
            requestId: message.requestId,
            suggestedPath: typeof params.suggestedPath === "string" ? params.suggestedPath : undefined,
          });
        } catch {
          setPendingFolder({
            requestId: message.requestId,
            suggestedPath: typeof params.suggestedPath === "string" ? params.suggestedPath : undefined,
          });
        }
        return;
      }

      if (message.method === "filesystem.list") {
        if (!selectedApp.permissions.includes(FILESYSTEM_READ_PERMISSION)) {
          reply(message.requestId, undefined, `This app has not declared the '${FILESYSTEM_READ_PERMISSION}' permission.`);
          return;
        }
        try {
          const entries = await invoke<FsEntry[]>("extension_fs_list", {
            input: {
              extensionId: selectedApp.extensionId,
              extensionPath: selectedApp.extensionPath,
              relativePath: typeof params.relativePath === "string" ? params.relativePath : null,
            },
          });
          reply(message.requestId, entries);
        } catch (reason) {
          reply(message.requestId, undefined, reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }

      if (message.method === "filesystem.readText") {
        if (!selectedApp.permissions.includes(FILESYSTEM_READ_PERMISSION)) {
          reply(message.requestId, undefined, `This app has not declared the '${FILESYSTEM_READ_PERMISSION}' permission.`);
          return;
        }
        if (typeof params.relativePath !== "string" || !params.relativePath.trim()) {
          reply(message.requestId, undefined, "filesystem.readText requires a relativePath.");
          return;
        }
        try {
          const text = await invoke<string>("extension_fs_read", {
            input: {
              extensionId: selectedApp.extensionId,
              extensionPath: selectedApp.extensionPath,
              relativePath: params.relativePath,
            },
          });
          reply(message.requestId, { text });
        } catch (reason) {
          reply(message.requestId, undefined, reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }

      if (message.method === "filesystem.writeText") {
        if (!selectedApp.permissions.includes(FILESYSTEM_WRITE_PERMISSION)) {
          reply(message.requestId, undefined, `This app has not declared the '${FILESYSTEM_WRITE_PERMISSION}' permission.`);
          return;
        }
        if (typeof params.relativePath !== "string" || !params.relativePath.trim()) {
          reply(message.requestId, undefined, "filesystem.writeText requires a relativePath.");
          return;
        }
        if (typeof params.text !== "string") {
          reply(message.requestId, undefined, "filesystem.writeText requires text.");
          return;
        }
        try {
          await invoke("extension_fs_write", {
            input: {
              extensionId: selectedApp.extensionId,
              extensionPath: selectedApp.extensionPath,
              relativePath: params.relativePath,
              text: params.text,
            },
          });
          reply(message.requestId, { written: true });
        } catch (reason) {
          reply(message.requestId, undefined, reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }

      if (message.method === "extension.execute") {
        const command = typeof params.command === "string" ? params.command : "";
        if (!command || !selectedApp.manifest.commands?.some((item) => item.id === command)) {
          reply(message.requestId, undefined, "This app requested an undeclared extension command.");
          return;
        }
        try {
          const execution = await invoke<unknown>("extension_execute", {
            input: {
              extensionPath: selectedApp.extensionPath,
              manifest: selectedApp.manifest,
              command,
              input: params.input ?? null,
              context: { source: "app-ui" },
            },
          });
          if (!execution || typeof execution !== "object") throw new Error("The extension returned an invalid response.");
          const rpcResponse = execution as { result?: unknown; error?: unknown };
          if (rpcResponse.error && typeof rpcResponse.error === "object") {
            const rpcError = (rpcResponse.error as { message?: unknown }).message;
            throw new Error(typeof rpcError === "string" ? rpcError : "The extension RPC request failed.");
          }
          // Rust returns the complete JSON-RPC response: { id, result: { success, output } }.
          // Unwrap its result before checking the SDK's command response.
          const commandResponse = "result" in rpcResponse ? rpcResponse.result : execution;
          if (!commandResponse || typeof commandResponse !== "object") throw new Error("The extension returned an invalid command response.");
          const result = commandResponse as { success?: unknown; output?: unknown; error?: unknown };
          if (result.success !== true) throw new Error(typeof result.error === "string" ? result.error : "The extension command failed.");
          reply(message.requestId, result.output);
        } catch (reason) {
          reply(message.requestId, undefined, reason instanceof Error ? reason.message : String(reason));
        }
        return;
      }

      reply(message.requestId, undefined, "Unsupported Mocu app API method.");
    };

    window.addEventListener("message", handleAppMessage);
    return () => window.removeEventListener("message", handleAppMessage);
  }, [selectedApp, appUrl, pendingSelection, pendingFolder]);

  const openApp = async (app: AppLaunchItem) => {
    setError(null);
    setSelectionResult(null);
    setSelectedApp(app);
    setAppUrl(null);
    try {
      const entryPath = await invoke<string>("extension_app_url", {
        input: {
          extensionId: app.extensionId,
          extensionPath: app.extensionPath,
        },
      });
      setAppUrl(toAssetUrl(entryPath));
    } catch (reason) {
      setSelectedApp(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const finishSelectionRequest = (allowed: boolean) => {
    if (!pendingSelection) return;
    const iframe = iframeRef.current;
    iframe?.contentWindow?.postMessage({
      type: "mocu:response",
      requestId: pendingSelection.requestId,
      ...(allowed
        ? { result: { text: pendingSelection.selectedText } }
        : { error: "Permission request was declined." }),
    }, "*");
    if (allowed) setSelectionResult(pendingSelection.selectedText || "(No text is selected in the app.)");
    setPendingSelection(null);
  };

  const finishFolderRequest = async (allowed: boolean) => {
    if (!pendingFolder || !selectedApp) return;
    const request = pendingFolder;
    setPendingFolder(null);
    const iframe = iframeRef.current;
    if (!allowed) {
      iframe?.contentWindow?.postMessage({
        type: "mocu:response",
        requestId: request.requestId,
        error: "Folder access request was declined.",
      }, "*");
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: request.suggestedPath,
        title: `Choose a folder for ${selectedApp.title}`,
      });
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (typeof folderPath !== "string") throw new Error("No folder was selected.");
      await invoke("extension_fs_grant", {
        input: {
          extensionId: selectedApp.extensionId,
          extensionPath: selectedApp.extensionPath,
          rootPath: folderPath,
        },
      });
      iframe?.contentWindow?.postMessage({
        type: "mocu:response",
        requestId: request.requestId,
        result: { granted: true, rootPath: "" },
      }, "*");
    } catch (reason) {
      iframe?.contentWindow?.postMessage({
        type: "mocu:response",
        requestId: request.requestId,
        error: reason instanceof Error ? reason.message : String(reason),
      }, "*");
    }
  };

  const closeApp = () => {
    if (pendingSelection) finishSelectionRequest(false);
    if (pendingFolder) void finishFolderRequest(false);
    setSelectedApp(null);
    setAppUrl(null);
    setSelectionResult(null);
  };

  if (selectedApp) {
    return (
      <section className="extension-apps-page extension-apps-viewer">
        <header className="extension-apps-toolbar">
          <button type="button" className="extension-apps-back" onClick={closeApp}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to Apps
          </button>
          <strong>{selectedApp.title}</strong>
          <span>{selectedApp.extensionName}</span>
        </header>
        {appUrl ? (
          <iframe
            ref={iframeRef}
            className="extension-apps-frame"
            src={appUrl}
            title={selectedApp.title}
            sandbox="allow-scripts allow-forms allow-same-origin"
            allow="microphone"
            referrerPolicy="no-referrer"
          />
        ) : <p className="extension-apps-status">Opening app…</p>}
        {pendingSelection ? (
          <div className="extension-apps-consent-backdrop">
            <section className="extension-apps-consent" role="dialog" aria-modal="true" aria-labelledby="extension-app-consent-title">
              <h2 id="extension-app-consent-title">Allow selected-text access?</h2>
              <p><strong>{selectedApp.title}</strong> requests <code>selection.get()</code>. Review the selected text below; Mocu will share up to 20,000 characters with this app only if you approve.</p>
              <pre className="extension-apps-consent-preview">{pendingSelection.selectedText.slice(0, 500)}{pendingSelection.selectedText.length > 500 ? "…" : ""}{!pendingSelection.selectedText ? "(No text is selected in the app.)" : ""}</pre>
              <div>
                <button type="button" onClick={() => finishSelectionRequest(false)}>Decline</button>
                <button type="button" className="is-primary" onClick={() => finishSelectionRequest(true)}>Allow once</button>
              </div>
            </section>
          </div>
        ) : null}
        {pendingFolder ? (
          <div className="extension-apps-consent-backdrop">
            <section className="extension-apps-consent" role="dialog" aria-modal="true" aria-labelledby="extension-app-folder-title">
              <h2 id="extension-app-folder-title">Choose a folder to share</h2>
              <p><strong>{selectedApp.title}</strong> requests access to one folder and its contents. Mocu will show a native folder picker; access is limited to the folder you choose.</p>
              <div>
                <button type="button" onClick={() => void finishFolderRequest(false)}>Decline</button>
                <button type="button" className="is-primary" onClick={() => void finishFolderRequest(true)}>Choose folder…</button>
              </div>
            </section>
          </div>
        ) : null}
        {selectionResult !== null ? (
          <aside className="extension-apps-result" role="status">
            <strong>selection.get result</strong>
            <code>{selectionResult}</code>
          </aside>
        ) : null}
      </section>
    );
  }

  return (
    <section className="extension-apps-page">
      <header className="extension-apps-heading">
        <h1>Apps</h1>
        <p>Extension apps run in an isolated frame. Mocu APIs require a manifest permission and your approval.</p>
      </header>
      {loading ? <p className="extension-apps-status">Loading extension apps…</p> : null}
      {error ? <p className="extension-apps-error" role="alert">{error}</p> : null}
      {!loading && apps.length === 0 ? <p className="extension-apps-status">No installed extensions provide an app UI yet.</p> : null}
      <div className="extension-apps-grid">
        {apps.map((app) => (
          <article className="extension-apps-card" key={app.extensionId}>
            <span className="extension-apps-icon" aria-hidden="true"><FileCode2 size={23} /></span>
            <h2>{app.title}</h2>
            <p>{app.description || app.extensionName}</p>
            {app.permissions.includes(FILESYSTEM_READ_PERMISSION) ? (
              <span className="extension-apps-permission">filesystem.read declared</span>
            ) : null}
            {app.permissions.includes(FILESYSTEM_WRITE_PERMISSION) ? (
              <span className="extension-apps-permission">filesystem.write declared</span>
            ) : null}
            <button type="button" className="extension-apps-open" onClick={() => void openApp(app)}>Open app</button>
          </article>
        ))}
      </div>
    </section>
  );
}
