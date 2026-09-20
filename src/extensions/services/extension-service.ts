import type { InstalledExtension } from "../types/extension";

import { executeExtension } from "./extension-client";

import { resolveExtensionConfig } from "./extension-config";

/**
 * Execute one of an extension's commands. The extension is spawned lazily by
 * the Rust manager if it is not already running, so callers never need to
 * start or configure it first.
 *
 * The user-filled config values (manifest `config` fields) are resolved
 * here — merged with defaults — and delivered to the extension as the
 * `config` param of `extension.execute`.
 */
export async function executeExtensionCommand<T = unknown>(
  extension: InstalledExtension,
  command: string,
  input?: unknown,
  context?: Record<string, unknown>,
): Promise<T> {
  const config = await resolveExtensionConfig(extension.manifest);

  return (await executeExtension(
    extension.path,
    extension.manifest,
    command,
    input ?? null,
    context,
    config,
  )) as T;
}