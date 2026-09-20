import { useEffect, useState } from "react";

import type {
  ExtensionConfigField,
  InstalledExtension,
} from "../types/extension";

import {
  readExtensionConfigValues,
  saveExtensionConfigValues,
  type ExtensionConfigValues,
} from "../services/extension-config";

interface ExtensionCardProps {
  extension: InstalledExtension;
  onUninstall: (extensionId: string) => void | Promise<void>;
}

/**
 * Turn one config field's saved/default value into the string shown in an
 * input (booleans are handled by checkboxes instead).
 */
function fieldInputValue(
  field: ExtensionConfigField,
  values: ExtensionConfigValues,
): string {
  const value = values[field.key];

  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

/**
 * Installed extension card. There are no Activate/Stop/execution buttons:
 * extensions run on demand from chat, so this card shows metadata, the
 * user-filled settings form (when the manifest declares `config` fields)
 * and offers deletion.
 */
export function ExtensionCard({
  extension,
  onUninstall,
}: ExtensionCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [configValues, setConfigValues] = useState<
    Record<string, string | boolean>
  >({});
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);

  const { manifest } = extension;

  const configFields = manifest.config ?? [];

  useEffect(() => {
    if (!settingsOpen || configLoaded) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const saved = await readExtensionConfigValues(manifest.id);

        if (cancelled) {
          return;
        }

        const next: Record<string, string | boolean> = {};

        for (const field of configFields) {
          if (field.type === "boolean") {
            const value = saved[field.key];

            next[field.key] =
              typeof value === "boolean"
                ? value
                : field.default === true;
          } else {
            const value = saved[field.key];

            next[field.key] =
              value === undefined || value === ""
                ? field.default !== undefined
                  ? String(field.default)
                  : ""
                : String(value);
          }
        }

        setConfigValues(next);
        setConfigLoaded(true);
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : String(reason),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settingsOpen, configLoaded, manifest.id, configFields]);

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

  const handleSaveConfig = async (): Promise<void> => {
    setConfigBusy(true);
    setError(null);
    setConfigSaved(false);

    try {
      await saveExtensionConfigValues(
        manifest.id,
        configFields,
        configValues,
      );

      setConfigSaved(true);
      window.setTimeout(() => setConfigSaved(false), 2500);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setConfigBusy(false);
    }
  };

  const updateConfigValue = (
    key: string,
    value: string | boolean,
  ): void => {
    setConfigValues((current) => ({
      ...current,
      [key]: value,
    }));
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

      {configFields.length > 0 && (
        <div className="extensions-card-config">
          <button
            type="button"
            className="extensions-config-toggle"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            {settingsOpen ? "▾" : "▸"} Settings
          </button>

          {settingsOpen && (
            <div className="extensions-config-form">
              {configFields.map((field) => (
                <label
                  key={field.key}
                  className="extensions-config-field"
                >
                  <span className="extensions-config-label">
                    {field.label}
                    {field.required ? " *" : ""}
                  </span>

                  {field.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={
                        configValues[field.key] === true
                      }
                      onChange={(event) =>
                        updateConfigValue(
                          field.key,
                          event.target.checked,
                        )
                      }
                    />
                  ) : (
                    <input
                      type={
                        field.type === "number"
                          ? "number"
                          : field.type === "password"
                            ? "password"
                            : "text"
                      }
                      value={fieldInputValue(field, configValues as ExtensionConfigValues)}
                      placeholder={
                        field.placeholder ??
                        (field.default !== undefined
                          ? String(field.default)
                          : "")
                      }
                      onChange={(event) =>
                        updateConfigValue(
                          field.key,
                          event.target.value,
                        )
                      }
                    />
                  )}

                  {field.description && (
                    <span className="extensions-config-hint">
                      {field.description}
                    </span>
                  )}
                </label>
              ))}

              <div className="extensions-config-actions">
                <button
                  type="button"
                  className="extensions-button is-primary"
                  disabled={configBusy}
                  onClick={() => void handleSaveConfig()}
                >
                  {configBusy ? "Saving…" : "Save settings"}
                </button>

                {configSaved && (
                  <span className="extensions-config-saved">
                    Saved ✓
                  </span>
                )}
              </div>

              <p className="extensions-config-note">
                These values are sent to the extension every time it runs.
              </p>
            </div>
          )}
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
