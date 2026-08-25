import { useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import {
  EXTENSION_CATALOG,
} from "../services/extension-catalog";

import {
  ExtensionCard,
} from "./ExtensionCard";

import {
  useExtensions,
} from "../hooks/useExtensions";

import "./extensions.css";

type ExtensionsView = "browse" | "installed";

/*
 * Installs one bundled/catalog extension with a one-click action.
 */
function installEntry(
  entryId: string,
  catalog: typeof EXTENSION_CATALOG,
  installBundled: (entry: (typeof EXTENSION_CATALOG)[number]) => Promise<unknown>,
): Promise<unknown> {
  const entry = catalog.find((candidate) => candidate.id === entryId);

  if (!entry) {
    return Promise.reject(
      new Error(`Unknown bundled extension: ${entryId}`),
    );
  }

  return installBundled(entry);
}

export function ExtensionsPage() {
  const {
    extensions,
    loading,
    error,
    refresh,
    install,
    installBundled,
    uninstall,
  } = useExtensions();

  const [view, setView] = useState<ExtensionsView>("browse");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [pageError, setPageError] = useState<string | null>(null);

  const installedIds = new Set(
    extensions.map((extension) => extension.manifest.id),
  );

  const withBusy = async (
    id: string,
    action: () => Promise<unknown>,
  ): Promise<void> => {
    setBusyIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setPageError(null);

    try {
      await action();
    } catch (reason) {
      setPageError(
        reason instanceof Error
          ? reason.message
          : String(reason),
      );
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const handleInstallCatalog = (entryId: string): void => {
    void withBusy(entryId, () =>
      installEntry(entryId, EXTENSION_CATALOG, installBundled),
    );
  };

  const handleUninstall = (extensionId: string): void => {
    void withBusy(extensionId, () => uninstall(extensionId));
  };

  const handleInstallZip = async (): Promise<void> => {
    const selected = await open({
      filters: [
        {
          name: "Extension archive",
          extensions: ["zip"],
        },
      ],
      multiple: false,
      title: "Choose an extension ZIP file",
    });

    if (selected === null) {
      return;
    }

    const filePath = Array.isArray(selected)
      ? selected[0]
      : selected;

    if (!filePath) {
      return;
    }

    void withBusy("__zip__", () => install(filePath, false));
  };

  const handleInstallFolder = async (): Promise<void> => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose an extension folder",
    });

    if (selected === null) {
      return;
    }

    const folderPath = Array.isArray(selected)
      ? selected[0]
      : selected;

    if (typeof folderPath !== "string") {
      return;
    }

    void withBusy("__folder__", () => install(folderPath, true));
  };

  return (
    <section className="extensions-page">
      <header className="extensions-header">
        <div className="extensions-heading">
          <h1>Extensions</h1>
          <p>Install, delete, and run Python &amp; Node.js extensions on demand from chat.</p>
        </div>

        <div className="extensions-header-actions">
          <button
            className="extensions-button"
            disabled={loading}
            onClick={() => void refresh()}
          >
            Refresh
          </button>

          <button
            className="extensions-button"
            disabled={loading}
            onClick={() => void handleInstallFolder()}
          >
            Install from Folder
          </button>

          <button
            className="extensions-button"
            disabled={loading}
            onClick={() => void handleInstallZip()}
          >
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

      {loading && (
        <p className="extensions-status">Loading extensions…</p>
      )}

      {error && (
        <pre className="extensions-error">
          {error}
        </pre>
      )}

      {pageError && (
        <pre className="extensions-error">
          {pageError}
        </pre>
      )}

      {!loading && view === "browse" && (
        <section className="extensions-grid">
          {EXTENSION_CATALOG.map((entry) => {
            const isInstalled = installedIds.has(entry.id);
            const isBusy = busyIds.has(entry.id);

            return (
              <article key={entry.id} className="extensions-card">
                <header className="extensions-card-header">
                  <h3>{entry.name}</h3>
                  <span className="extensions-card-badge">
                    {entry.runtime}
                  </span>
                </header>

                <p className="extensions-card-description">
                  {entry.description}
                </p>

                <div className="extensions-card-meta">
                  <span>{entry.version}</span>
                  <span>by {entry.author}</span>
                </div>

                <div className="extensions-card-tags">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="extensions-tag">{tag}</span>
                  ))}
                </div>

                <div className="extensions-card-actions">
                  {isInstalled ? (
                    <button
                      type="button"
                      className="extensions-button"
                      disabled
                    >
                      ✓ Installed
                    </button>
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
          {!loading && extensions.length === 0 && (
            <p className="extensions-empty">
              No extensions are installed yet.
            </p>
          )}

          {extensions.map((extension) => (
            <ExtensionCard
              key={extension.manifest.id}
              extension={extension}
              onUninstall={handleUninstall}
            />
          ))}
        </section>
      )}
    </section>
  );
}