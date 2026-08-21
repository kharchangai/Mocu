import { useCallback, useEffect, useState } from "react";

import type { InstalledExtension } from "../types/extension";

import {
  activateExtension,
  deactivateExtension,
  executeExtensionCommand,
} from "../services/extension-service";

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

import {
  registerExtensionHost,
} from "../services/host-service";

export function useExtensions() {
  const [extensions, setExtensions] = useState<
    InstalledExtension[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [runningExtensions, setRunningExtensions] = useState<
    Set<string>
  >(new Set());

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

  const activate = useCallback(
    async (extension: InstalledExtension) => {
      await activateExtension(extension);

      setRunningExtensions((current) => {
        const next = new Set(current);
        next.add(extension.manifest.id);
        return next;
      });
    },
    [],
  );

  const deactivate = useCallback(
    async (extensionId: string) => {
      await deactivateExtension(extensionId);

      setRunningExtensions((current) => {
        const next = new Set(current);
        next.delete(extensionId);
        return next;
      });
    },
    [],
  );

  const execute = useCallback(
    async <T,>(
      extension: InstalledExtension,
      command: string,
      input?: unknown,
    ): Promise<T> => {
      const result = await executeExtensionCommand<T>(
        extension,
        command,
        input,
      );

      setRunningExtensions((current) => {
        const next = new Set(current);
        next.add(extension.manifest.id);
        return next;
      });

      return result;
    },
    [],
  );

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    /*
     * Register the app-side host handler once. This is what lets
     * extensions call Mocu host methods (LLM, settings, dialogs) and
     * receive answers back through Rust.
     */
    registerExtensionHost();
  }, []);

  const uninstall = useCallback(
    async (extensionId: string): Promise<void> => {
      await uninstallExtension(extensionId);
      await refresh();

      setRunningExtensions((current) => {
        const next = new Set(current);
        next.delete(extensionId);
        return next;
      });
    },
    [refresh],
  );

  return {
    extensions,
    runningExtensions,
    loading,
    error,
    refresh,
    activate,
    deactivate,
    execute,
    install,
    installBundled,
    uninstall,
  };
}