import { useCallback, useEffect, useState } from "react";

import type { InstalledExtension } from "../types/extension";
import { scanInstalledExtensions } from "../services/extension-scanner";
import {
  loadInstallableExtensions,
  type ExtensionCatalogEntry,
} from "../services/extension-catalog";
import {
  installExtensionFromFolder,
  installExtensionFromZip,
  installBundledExtension,
  uninstallExtension,
  type InstalledExtensionResult,
} from "../services/extension-installer";

/** Installed extensions and bundled extensions available to install. */
export function useExtensions() {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const [catalog, setCatalog] = useState<ExtensionCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [installed, installable] = await Promise.all([
        scanInstalledExtensions(),
        loadInstallableExtensions(),
      ]);
      setExtensions(installed);
      setCatalog(installable);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  const install = useCallback(
    async (sourcePath: string, isDirectory: boolean): Promise<InstalledExtensionResult> => {
      const result = isDirectory
        ? await installExtensionFromFolder(sourcePath)
        : await installExtensionFromZip(sourcePath);
      await refresh();
      return result;
    },
    [refresh],
  );

  const installBundled = useCallback(
    async (entry: ExtensionCatalogEntry): Promise<InstalledExtensionResult> => {
      const result = await installBundledExtension(entry);
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

  return { extensions, catalog, loading, error, refresh, install, installBundled, uninstall };
}
