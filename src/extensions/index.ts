export { ExtensionsPage } from "./components/ExtensionsPage";

export { ExtensionCard } from "./components/ExtensionCard";

export {
  activateExtension,
  deactivateExtension,
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

export {
  registerExtensionHost,
} from "./services/host-service";

export {
  startExtension,
  stopExtension,
  requestExtension,
  notifyExtension,
  getExtensionStatus,
  respondExtension,
  setExtensionMessageHandler,
} from "./services/extension-client";

export type {
  ExtensionManifest,
  InstalledExtension,
  ExtensionRuntime,
  ExtensionCommand,
} from "./types/extension";