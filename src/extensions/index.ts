export { ExtensionsPage } from "./components/ExtensionsPage";

export { ExtensionCard } from "./components/ExtensionCard";

export {
  executeExtensionCommand,
} from "./services/extension-service";

export {
  scanInstalledExtensions,
  ensureExtensionsDirectory,
} from "./services/extension-scanner";

export {
  installExtensionFromZip,
  installExtensionFromFolder,
  installBundledExtension,
  uninstallExtension,
  type InstalledExtensionResult,
} from "./services/extension-installer";

export {
  EXTENSION_CATALOG,
  type ExtensionCatalogEntry,
} from "./services/extension-catalog";

export { startExtensionHost } from "./services/host-service";

export {
  executeExtension,
  stopExtension,
  respondExtension,
} from "./services/extension-client";

export type {
  ExtensionManifest,
  InstalledExtension,
  ExtensionRuntime,
  ExtensionCommand,
} from "./types/extension";
