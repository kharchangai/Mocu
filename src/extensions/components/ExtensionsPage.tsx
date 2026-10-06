import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ResourceDeleteDialog } from "../../components/ResourceDeleteDialog";
import { open } from "@tauri-apps/plugin-dialog";
import { ExtensionCard } from "./ExtensionCard";
import { useExtensions } from "../hooks/useExtensions";
import "./extensions.css";

type ExtensionsView = "browse" | "installed";

export function ExtensionsPage() {
  const {
    extensions,
    catalog,
    loading,
    error,
    refresh,
    install,
    installBundled,
    uninstall,
  } = useExtensions();

  const [view, setView] = useState<ExtensionsView>("browse");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [busyMessages, setBusyMessages] = useState<Record<string, string>>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [extensionToDelete, setExtensionToDelete] = useState<{ id: string; name: string } | null>(null);

  const installedIds = new Set(extensions.map((extension) => extension.manifest.id));

  const withBusy = async (
    id: string,
    action: () => Promise<unknown>,
    message: string,
    rethrow = false,
  ): Promise<void> => {
    setBusyIds((current) => new Set(current).add(id));
    setBusyMessages((current) => ({ ...current, [id]: message }));
    setPageError(null);

    try {
      await action();
    } catch (reason) {
      if (rethrow) throw reason;
      setPageError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setBusyMessages((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const handleInstallCatalog = (entryId: string): void => {
    const entry = catalog.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setPageError(`Unknown bundled extension: ${entryId}`);
      return;
    }
    void withBusy(entryId, () => installBundled(entry), "Installing extension…");
  };

  const handleUninstall = (extensionId: string, extensionName: string): void => {
    setExtensionToDelete({ id: extensionId, name: extensionName });
  };

  const confirmUninstall = async (): Promise<void> => {
    if (!extensionToDelete) return;
    await withBusy(
      extensionToDelete.id,
      () => uninstall(extensionToDelete.id),
      "Uninstalling extension…",
      true,
    );
    setExtensionToDelete(null);
  };

  const handleInstallZip = async (): Promise<void> => {
    const selected = await open({
      filters: [{ name: "Extension archive", extensions: ["zip"] }],
      multiple: false,
      title: "Choose an extension ZIP file",
    });
    if (selected === null) return;
    const filePath = Array.isArray(selected) ? selected[0] : selected;
    if (filePath) {
      void withBusy("__zip__", () => install(filePath, false), "Installing extension from ZIP…");
    }
  };

  const handleInstallFolder = async (): Promise<void> => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose an extension folder",
    });
    if (selected === null) return;
    const folderPath = Array.isArray(selected) ? selected[0] : selected;
    if (typeof folderPath === "string") {
      void withBusy("__folder__", () => install(folderPath, true), "Installing extension from folder…");
    }
  };

  return (
    <section className="extensions-page">
      <header className="extensions-header">
        <div className="extensions-heading">
          <h1>Extensions</h1>
          <p>Install, delete, and run Python &amp; Node.js extensions on demand from chat.</p>
        </div>
        <div className="extensions-header-actions">
          <button className="extensions-button" disabled={loading} onClick={() => void refresh()}>
            Refresh
          </button>
          <button className="extensions-button" disabled={loading} onClick={() => void handleInstallFolder()}>
            Install from Folder
          </button>
          <button className="extensions-button" disabled={loading} onClick={() => void handleInstallZip()}>
            Install from ZIP
          </button>
        </div>
      </header>

      <nav className="extensions-tabs" aria-label="Extension views">
        <button
          type="button"
          className={`extensions-tab ${view === "browse" ? "is-active" : ""}`}
          onClick={() => setView("browse")}
        >
          Browse
        </button>
        <button
          type="button"
          className={`extensions-tab ${view === "installed" ? "is-active" : ""}`}
          onClick={() => setView("installed")}
        >
          Installed
          <span className="extensions-tab-count">{installedIds.size}</span>
        </button>
      </nav>

      {loading && <p className="extensions-status">Loading extensions…</p>}
      {error && <pre className="extensions-error">{error}</pre>}
      {pageError && <pre className="extensions-error">{pageError}</pre>}
      {Object.keys(busyMessages).length > 0 && (
        <div className="extensions-operation-status" role="status" aria-live="polite">
          <LoaderCircle size={16} />{Object.values(busyMessages)[0]}
        </div>
      )}

      {!loading && view === "browse" && (
        <section className="extensions-grid">
          {catalog.length === 0 && (
            <p className="extensions-empty">No bundled extensions found in extensions-default.</p>
          )}
          {catalog.map((entry) => {
            const isInstalled = installedIds.has(entry.id);
            const isBusy = busyIds.has(entry.id);
            return (
              <article key={entry.id} className="extensions-card">
                <header className="extensions-card-header">
                  <h3>{entry.name}</h3>
                  <span className="extensions-card-badge">{entry.runtime}</span>
                </header>
                <p className="extensions-card-description">{entry.description}</p>
                <div className="extensions-card-meta">
                  <span>{entry.version}</span>
                  <span>by {entry.author}</span>
                </div>
                <div className="extensions-card-tags">
                  {entry.tags.map((tag) => <span key={tag} className="extensions-tag">{tag}</span>)}
                </div>
                <div className="extensions-card-actions">
                  {isInstalled ? (
                    <button type="button" className="extensions-button" disabled>✓ Installed</button>
                  ) : (
                    <button
                      type="button"
                      className="extensions-button is-primary"
                      disabled={isBusy || loading}
                      onClick={() => handleInstallCatalog(entry.id)}
                    >
                      {isBusy ? "Installing…" : "Install"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {!loading && view === "installed" && (
        <section className="extensions-grid">
          {extensions.length === 0 && <p className="extensions-empty">No extensions are installed yet.</p>}
          {extensions.map((extension) => (
            <ExtensionCard
              key={extension.manifest.id}
              extension={extension}
              onUninstall={(id) => handleUninstall(id, extension.manifest.name)}
            />
          ))}
        </section>
      )}

      {extensionToDelete ? (
        <ResourceDeleteDialog
          resourceType="Extension"
          resourceName={extensionToDelete.name}
          description="The installed extension and its files will be permanently removed."
          onCancel={() => setExtensionToDelete(null)}
          onConfirm={confirmUninstall}
        />
      ) : null}
    </section>
  );
}
