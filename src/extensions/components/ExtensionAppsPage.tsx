import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ArrowLeft, FileCode2 } from "lucide-react";

import "./extension-apps.css";

type AppLaunchItem = {
  extensionId: string;
  extensionName: string;
  title: string;
  extensionPath: string;
  permissions: string[];
};

type AppListing = {
  path: string;
  manifest: {
    id: string;
    name: string;
    permissions: string[];
    app: { entry: string; title?: string } | null;
  };
};

type PendingSelectionRequest = {
  requestId: string;
  selectedText: string;
};

const SELECTION_PERMISSION = "selection.read";
const MAX_SELECTION_LENGTH = 20_000;

export function ExtensionAppsPage() {
  const [apps, setApps] = useState<AppLaunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<AppLaunchItem | null>(null);
  const [appUrl, setAppUrl] = useState<string | null>(null);
  const [selectionResult, setSelectionResult] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<PendingSelectionRequest | null>(null);
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

    const handleAppMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframe.contentWindow || !event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message.type !== "mocu:request" || typeof message.requestId !== "string") return;
      if (message.method !== "selection.get") {
        reply(message.requestId, undefined, "Unsupported Mocu app API method.");
        return;
      }
      if (!selectedApp.permissions.includes(SELECTION_PERMISSION)) {
        reply(message.requestId, undefined, `This app has not declared the '${SELECTION_PERMISSION}' permission.`);
        return;
      }
      const params = message.params && typeof message.params === "object"
        ? message.params as Record<string, unknown>
        : {};
      const selectedText = typeof params.selectedText === "string"
        ? params.selectedText.slice(0, MAX_SELECTION_LENGTH)
        : "";
      if (pendingSelection) {
        reply(message.requestId, undefined, "Another permission request is already awaiting your approval.");
        return;
      }
      setPendingSelection({ requestId: message.requestId, selectedText });
    };

    window.addEventListener("message", handleAppMessage);
    return () => window.removeEventListener("message", handleAppMessage);
  }, [selectedApp, appUrl, pendingSelection]);

  const openApp = async (app: AppLaunchItem) => {
    setError(null);
    setSelectionResult(null);
    setSelectedApp(app);
    setAppUrl(null);
    try {
      const entryPath = await invoke<string>("extension_app_url", {
        input: { extensionId: app.extensionId, extensionPath: app.extensionPath },
      });
      setAppUrl(convertFileSrc(entryPath));
    } catch (reason) {
      setSelectedApp(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const finishSelectionRequest = (allowed: boolean) => {
    if (!pendingSelection) return;
    const iframe = iframeRef.current;
    if (allowed) {
      const text = pendingSelection.selectedText;
      setSelectionResult(text || "(No text is selected in the app.)");
      iframe?.contentWindow?.postMessage({
        type: "mocu:response",
        requestId: pendingSelection.requestId,
        result: { text },
      }, "*");
    } else {
      iframe?.contentWindow?.postMessage({
        type: "mocu:response",
        requestId: pendingSelection.requestId,
        error: "Permission request was declined.",
      }, "*");
    }
    setPendingSelection(null);
  };

  const closeApp = () => {
    if (pendingSelection) finishSelectionRequest(false);
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
            sandbox="allow-scripts allow-forms"
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
            <p>{app.extensionName}</p>
            <span className={app.permissions.includes(SELECTION_PERMISSION) ? "extension-apps-permission" : "extension-apps-no-permission"}>
              {app.permissions.includes(SELECTION_PERMISSION) ? "selection.read declared" : "selection.read not declared"}
            </span>
            <button type="button" className="extension-apps-open" onClick={() => void openApp(app)}>Open app</button>
          </article>
        ))}
      </div>
    </section>
  );
}
