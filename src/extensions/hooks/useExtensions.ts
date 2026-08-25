import { useCallback, useEffect, useState } from "react";

import type { InstalledExtension } from "../types/extension";

import { scanInstalledExtensions } from "../services/extension-scanner";

import {
  installExtensionFromFolder,
  installExtensionFromZip,
  installBundledExtension,
  uninstallExtension,
  type InstalledExtensionResult,
} from "../services/extension-installer";

import type {
  ExtensionCatalogEntry,
} from "../services/extension-catalog";

/**
 * Snapshot of installed extensions plus install / uninstall / refresh.
 *
 * There is intentionally no activation or running state: extensions are
 * spawned lazily by the Rust manager the moment a command is invoked, so the
 * UI only ever deals with "what is installed" and "install / delete".
 */
export function useExtensions() {
  const [extensions, setExtensions] = useState<
    InstalledExtension[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const installed = await scanInstalledExtensions();
      setExtensions(installed);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : String(reason),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const install = useCallback(
    async (
      sourcePath: string,
      isDirectory: boolean,
    ): Promise<InstalledExtensionResult> => {
      const result = isDirectory
        ? await installExtensionFromFolder(sourcePath)
        : await installExtensionFromZip(sourcePath);

      await refresh();

      return result;
    },
    [refresh],
  );

  const installBundled = useCallback(
    async (
      entry: ExtensionCatalogEntry,
    ): Promise<InstalledExtensionResult> => {
      const result = await installBundledExtension({
        id: entry.id,
        files: entry.files,
      });

      await refresh();

      return result;
    },
    [refresh],
  );

  const uninstall = useCallback(
    async (extensionId: string): Promise<void> => {
      await uninstallExtension(extensionId);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    extensions,
    loading,
    error,
    refresh,
    install,
    installBundled,
    uninstall,
  };
}