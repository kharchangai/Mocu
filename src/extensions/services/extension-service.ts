import type { InstalledExtension } from "../types/extension";

import { executeExtension } from "./extension-client";

/**
 * Execute one of an extension's commands. The extension is spawned lazily by
 * the Rust manager if it is not already running, so callers never need to
 * start or configure it first.
 */
export async function executeExtensionCommand<T = unknown>(
  extension: InstalledExtension,
  command: string,
  input?: unknown,
): Promise<T> {
  return (await executeExtension(
    extension.path,
    extension.manifest,
    command,
    input ?? null,
  )) as T;
}