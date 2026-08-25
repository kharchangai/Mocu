import { listen } from "@tauri-apps/api/event";

import { generateSimpleAnswer } from "../../services/ai";

import { respondExtension } from "./extension-client";

const MAX_LLM_PROMPT_LENGTH = 100_000;
const MAX_LLM_SYSTEM_PROMPT_LENGTH = 20_000;

/**
 * Handle host-bound JSON-RPC requests that extensions send toward Mocu.
 *
 * Rust forwards these as `extension://message` events. The only host method
 * currently supported is `mocu.llm.generate`, which lets an extension call
 * Mocu's configured model from inside a command. The result (or error) is
 * written back into the extension via Rust.
 */
async function handleHostMessage(
  extensionId: string,
  message: unknown,
): Promise<void> {
  if (!message || typeof message !== "object") {
    return;
  }

  const record = message as Record<string, unknown>;

  if (typeof record.method !== "string") {
    return;
  }

  const method = record.method;
  const params =
    record.params && typeof record.params === "object"
      ? (record.params as Record<string, unknown>)
      : {};

  const hasId = "id" in record;

  /*
   * Preserve the original id type (number or string). The SDKs key their
   * pending host requests by the exact id they sent, so stringifying a
   * numeric id would hang the extension's call.
   */
  const requestId =
    hasId &&
    (typeof record.id === "string" || typeof record.id === "number")
      ? (record.id as string | number)
      : null;

  if (method !== "mocu.llm.generate") {
    if (requestId !== null) {
      await respondExtension(extensionId, requestId, null, {
        code: -32601,
        message: `Unknown Mocu host method: ${method}`,
        data: null,
      });
    }
    return;
  }

  try {
    const prompt =
      typeof params.prompt === "string" ? params.prompt.trim() : "";

    if (!prompt) {
      throw new Error(
        "mocu.llm.generate requires a non-empty 'prompt' parameter.",
      );
    }

    if (prompt.length > MAX_LLM_PROMPT_LENGTH) {
      throw new Error(
        `mocu.llm.generate prompt is too long (maximum ${MAX_LLM_PROMPT_LENGTH} characters).`,
      );
    }

    const systemPrompt =
      typeof params.systemPrompt === "string" && params.systemPrompt.trim()
        ? params.systemPrompt.trim().slice(0, MAX_LLM_SYSTEM_PROMPT_LENGTH)
        : undefined;

    const temperature =
      typeof params.temperature === "number" &&
      Number.isFinite(params.temperature)
        ? Math.max(0, Math.min(2, params.temperature))
        : undefined;

    const maxTokens =
      typeof params.maxTokens === "number" &&
      Number.isInteger(params.maxTokens) &&
      params.maxTokens > 0
        ? params.maxTokens
        : undefined;

    const text = await generateSimpleAnswer(prompt, undefined, {
      systemPrompt,
      temperature,
      maxTokens,
    });

    if (requestId !== null) {
      await respondExtension(extensionId, requestId, { text }, null);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      `[Mocu Extension] ${method} failed for '${extensionId}':`,
      error,
    );

    if (requestId !== null) {
      await respondExtension(extensionId, requestId, null, {
        code: -32603,
        message: errorMessage,
        data: null,
      });
    }
  }
}

/**
 * Start the app-side host bridge. This must run once for the lifetime of the
 * app so extensions can call Mocu host methods (currently the LLM). Returns
 * a cleanup function.
 */
export function startExtensionHost(): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;

  void listen<{
    extensionId: string;
    message: unknown;
  }>("extension://message", (event) => {
    void handleHostMessage(
      event.payload.extensionId,
      event.payload.message,
    );
  }).then((unwrap) => {
    if (disposed) {
      unwrap();
    } else {
      unlisten = unwrap;
    }
  }).catch((error) => {
    console.error("[Mocu Extension] Failed to register host bridge:", error);
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}
