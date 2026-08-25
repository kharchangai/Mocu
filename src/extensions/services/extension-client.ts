import { invoke } from "@tauri-apps/api/core";

import type { ExtensionManifest } from "../types/extension";

/**
 * Run an extension command with lazy activation.
 *
 * Rust is fully in charge of the lifecycle: it registers the extension,
 * spawns the process on first use if it is not already running, routes the
 * `extension.execute` call, waits for the result, and returns it here. There
 * is no manual start/stop from the frontend.
 */
export async function executeExtension(
  path: string,
  manifest: ExtensionManifest,
  command: string,
  input?: unknown,
): Promise<unknown> {
  return invoke("extension_execute", {
    input: {
      extensionPath: path,
      manifest,
      command,
      input: input ?? null,
    },
  });
}

/**
 * Stop a running extension process. Only needed when uninstalling an
 * extension whose process is still alive; otherwise lifecycle is automatic.
 */
export async function stopExtension(
  extensionId: string,
): Promise<boolean> {
  return invoke("extension_stop", {
    input: { extensionId },
  });
}

/**
 * Send a JSON-RPC response back to an extension request.
 *
 * Used to resolve a host-bound request (e.g. `mocu.llm.generate`) that the
 * extension sent to the frontend. Rust writes the reply into the extension's
 * stdin so its SDK can resolve the pending call.
 */
export async function respondExtension(
  extensionId: string,
  requestId: string | number,
  result: unknown,
  error: {
    code: number;
    message: string;
    data?: unknown;
  } | null,
): Promise<void> {
  await invoke("extension_respond", {
    input: {
      extensionId,
      requestId,
      result: result ?? null,
      error: error ?? null,
    },
  });
}