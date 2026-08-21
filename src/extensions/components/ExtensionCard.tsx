import { useState } from "react";

import type { InstalledExtension } from "../types/extension";

interface ExtensionCardProps {
  extension: InstalledExtension;
  running: boolean;
  onActivate: (extension: InstalledExtension) => Promise<void>;
  onDeactivate: (extensionId: string) => Promise<void>;
  onExecute: (
    extension: InstalledExtension,
    command: string,
  ) => Promise<unknown>;
  onUninstall?: (extensionId: string) => void | Promise<void>;
}

export function ExtensionCard({
  extension,
  running,
  onActivate,
  onDeactivate,
  onExecute,
  onUninstall,
}: ExtensionCardProps) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { manifest } = extension;

  async function perform(
    action: () => Promise<unknown>,
  ): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const value = await action();

      if (value !== undefined) {
        setResult(JSON.stringify(value, null, 2));
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : String(reason),
      );
    } finally {
      setBusy(false);
    }
  }

  const handleUninstall = (): void => {
    if (onUninstall) {
      setBusy(true);
      void Promise.resolve(onUninstall(manifest.id)).finally(() =>
        setBusy(false),
      );
    }
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

      <div className="extensions-card-status">
        Status:{" "}
        <strong className={running ? "is-running" : "is-stopped"}>
          {running ? "Enabled" : "Disabled"}
        </strong>
      </div>

      <div className="extensions-card-actions">
        {!running ? (
          <button
            type="button"
            className="extensions-button is-primary"
            disabled={busy}
            onClick={() => void perform(() => onActivate(extension))}
          >
            Activate
          </button>
        ) : (
          <button
            type="button"
            className="extensions-button"
            disabled={busy}
            onClick={() => void perform(() => onDeactivate(manifest.id))}
          >
            Stop
          </button>
        )}

        {(manifest.commands ?? []).map((command) => (
          <button
            key={command.id}
            type="button"
            className="extensions-button"
            disabled={busy}
            title={command.description}
            onClick={() =>
              void perform(() => onExecute(extension, command.id))
            }
          >
            {command.title}
          </button>
        ))}

        {onUninstall && (
          <button
            type="button"
            className="extensions-button is-danger"
            disabled={busy}
            onClick={handleUninstall}
          >
            Uninstall
          </button>
        )}
      </div>

      {error && <pre className="extensions-error">{error}</pre>}
      {result && <pre className="extensions-result">{result}</pre>}
    </article>
  );
}