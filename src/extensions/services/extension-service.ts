import type { InstalledExtension } from "../types/extension";

import {
  getExtensionStatus,
  requestExtension,
  startExtension,
  stopExtension,
} from "./extension-client";

export interface ExtensionInitializeParams {
  extensionId: string;
  extensionPath: string;
  appName: string;
  appVersion: string;
}

export interface ExtensionActivateParams {
  extensionId: string;
}

export async function activateExtension(
  extension: InstalledExtension,
): Promise<void> {
  const { manifest, path } = extension;

  const status = await getExtensionStatus(manifest.id);

  if (!status.running) {
    await startExtension(path, manifest);
  }

  await requestExtension(
    manifest.id,
    "extension.initialize",
    {
      extensionId: manifest.id,
      extensionPath: path,
      appName: "Mocu",
      appVersion: "0.1.0",
    } satisfies ExtensionInitializeParams,
  );

  await requestExtension(
    manifest.id,
    "extension.activate",
    {
      extensionId: manifest.id,
    } satisfies ExtensionActivateParams,
  );
}

export async function executeExtensionCommand<T = unknown>(
  extension: InstalledExtension,
  command: string,
  input?: unknown,
): Promise<T> {
  const status = await getExtensionStatus(
    extension.manifest.id,
  );

  if (!status.running) {
    await activateExtension(extension);
  }

  return requestExtension<T>(
    extension.manifest.id,
    "extension.execute",
    {
      command,
      input: input ?? null,
    },
    30_000,
  );
}

export async function deactivateExtension(
  extensionId: string,
): Promise<void> {
  const status = await getExtensionStatus(extensionId);

  if (!status.running) {
    return;
  }

  try {
    await requestExtension(
      extensionId,
      "extension.deactivate",
      {},
      5_000,
    );
  } finally {
    await stopExtension(extensionId);
  }
}