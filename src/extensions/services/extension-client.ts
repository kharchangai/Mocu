import {
  invoke,
} from "@tauri-apps/api/core";

import {
  listen,
} from "@tauri-apps/api/event";

import type {
  ExtensionManifest,
  ExtensionStartResult,
  ExtensionStatus,
  JsonRpcMessage,
} from "../types/extension";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/*
 * Host-initiated JSON-RPC requests are stored here until the extension
 * responds. The extension SDK writes responses to stdout, the Rust host
 * forwards them back as `extension://message` events, and we resolve the
 * matching pending promise by id.
 */
const pendingRequests =
  new Map<string, PendingRequest>();

let listenerPromise: Promise<void> | null = null;

/*
 * Optional callback used by the app host layer to intercept requests or
 * notifications that extensions send toward Mocu (for example
 * `mocu.llm.generate` or `mocu.getSettings`).
 */
let hostMessageHandler:
  | ((extensionId: string, message: JsonRpcMessage) => void)
  | null = null;

export function setExtensionMessageHandler(
  handler:
    | ((extensionId: string, message: JsonRpcMessage) => void)
    | null,
): void {
  hostMessageHandler = handler;
}

function ensureExtensionListener(): Promise<void> {
  if (listenerPromise) {
    return listenerPromise;
  }

  listenerPromise = (async () => {
    const unlisten = await listen<{
      extensionId: string;
      message: JsonRpcMessage;
    }>("extension://message", (event) => {
      handleIncoming(event.payload);
    });

    // Keep a reference so future cleanup code can detach the listener.
    void unlisten;
  })();

  return listenerPromise;
}

function handleIncoming(payload: {
  extensionId: string;
  message: JsonRpcMessage;
}): void {
  const message = payload.message;

  if (!message || typeof message !== "object") {
    return;
  }

  const record = message as unknown as Record<string, unknown>;

  // A response to one of our pending requests.
  if (
    "id" in record &&
    ("result" in record || "error" in record)
  ) {
    const requestId = String(record.id);

    if (pendingRequests.has(requestId)) {
      const pending = pendingRequests.get(requestId)!;
      pendingRequests.delete(requestId);

      if ("error" in record) {
        const rawError = record.error;
        const errorMessage =
          rawError && typeof rawError === "object"
            ? (rawError as { message?: unknown }).message
            : null;

        pending.reject(
          new Error(
            typeof errorMessage === "string"
              ? errorMessage
              : "The extension returned an error.",
          ),
        );
      } else {
        pending.resolve(record.result ?? null);
      }
    }

    return;
  }

  // A request or notification initiated by the extension.
  if ("method" in record) {
    hostMessageHandler?.(payload.extensionId, message);
  }
}

/**
 * Start a Node.js or Python extension process through the Rust host.
 */
export async function startExtension(
  path: string,
  manifest: ExtensionManifest,
): Promise<ExtensionStartResult> {
  await ensureExtensionListener();

  return invoke<ExtensionStartResult>("extension_start", {
    input: {
      extensionPath: path,
      manifest,
    },
  });
}

/**
 * Stop a running extension process.
 */
export async function stopExtension(
  extensionId: string,
): Promise<boolean> {
  return invoke<boolean>("extension_stop", {
    input: {
      extensionId,
    },
  });
}

/**
 * Ask an extension for its current running state.
 */
export async function getExtensionStatus(
  extensionId: string,
): Promise<ExtensionStatus> {
  await ensureExtensionListener();

  return invoke<ExtensionStatus>("extension_status", {
    input: {
      extensionId,
    },
  });
}

/**
 * Send a JSON-RPC request to an extension and await its response.
 */
export async function requestExtension<T = unknown>(
  extensionId: string,
  method: string,
  params?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  await ensureExtensionListener();

  const requestId = crypto.randomUUID();

  const resultPromise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);

        reject(
          new Error(
            `Extension request "${method}" timed out after ${timeoutMs}ms.`,
          ),
        );
      }
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });

  await invoke("extension_send_request", {
    input: {
      extensionId,
      requestId,
      method,
      params: params ?? null,
    },
  }).catch((error) => {
    pendingRequests.delete(requestId);
    throw error;
  });

  return resultPromise;
}

/**
 * Send a fire-and-forget JSON-RPC notification to an extension.
 */
export async function notifyExtension(
  extensionId: string,
  method: string,
  params?: unknown,
): Promise<void> {
  await ensureExtensionListener();

  await invoke("extension_send_notification", {
    input: {
      extensionId,
      method,
      params: params ?? null,
    },
  });
}

/**
 * Send a JSON-RPC response back to an extension-initiated request.
 *
 * This is how Rust stays the middleware: the extension calls a host
 * method, the frontend resolves it, then writes the result through Rust
 * into the extension's stdin.
 */
export async function respondExtension(
  extensionId: string,
  requestId: string,
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