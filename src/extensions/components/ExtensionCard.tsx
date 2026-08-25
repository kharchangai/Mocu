import { useState } from "react";

import type { InstalledExtension } from "../types/extension";

interface ExtensionCardProps {
  extension: InstalledExtension;
  onUninstall: (extensionId: string) => void | Promise<void>;
}

/**
 * Installed extension card. There are no Activate/Stop/execution buttons:
 * extensions run on demand from chat, so this card only shows metadata and
 * offers deletion.
 */
export function ExtensionCard({
  extension,
  onUninstall,
}: ExtensionCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { manifest } = extension;

  const handleUninstall = (): void => {
    if (!onUninstall) {
      return;
    }

    setBusy(true);
    setError(null);

    Promise.resolve(onUninstall(manifest.id)).catch((reason) => {
      setError(
        reason instanceof Error
          ? reason.message
          : String(reason),
      );
    }).finally(() => setBusy(false));
  };

  return (
    <article className="extensions-card">
      <header className="extensions-card-header">
        <h3>{manifest.name}</h3>
        <span className="extensions-card-badge">
          {manifest.runtime}
        </span>
      </header>

      <p className="extensions-card-description">
        {manifest.description}
      </p>

      <div className="extensions-card-meta">
        <span>{manifest.id}</span>
        <span>{manifest.version}</span>
      </div>

      {(manifest.commands ?? []).length > 0 && (
        <div className="extensions-card-commands">
          {(manifest.commands ?? []).map((command) => (
            <span key={command.id} className="extensions-tag">
              {command.title}
            </span>
          ))}
        </div>
      )}

      <div className="extensions-card-actions">
        <button
          type="button"
          className="extensions-button is-danger"
          disabled={busy}
          onClick={handleUninstall}
        >
          Uninstall
        </button>
      </div>

      {error && <pre className="extensions-error">{error}</pre>}
    </article>
  );
}