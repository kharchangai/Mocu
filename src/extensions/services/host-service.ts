import {
  message,
} from "@tauri-apps/plugin-dialog";

import {
  readSettings,
  saveSettings,
} from "../../store";

import {
  chatWithMocu,
} from "../../services/ai";

import type {
  JsonRpcMessage,
} from "../types/extension";

import {
  respondExtension,
  setExtensionMessageHandler,
} from "./extension-client";

type HostMessageRecord = Record<
  string,
  unknown
>;

/**
 * Routes host-bound JSON-RPC messages that extensions send toward
 * Mocu. Rust forwards them as events; the frontend owns the actual
 * Mocu capabilities (LLM, settings, dialogs, events), so it resolves
 * the request and replies through the `extension_respond` Rust command.
 */
function handleHostMessage(
  extensionId: string,
  message: JsonRpcMessage,
): void {
  const record = message as unknown as HostMessageRecord;

  if (typeof record.method !== "string") {
    return;
  }

  const method = record.method;
  const params =
    record.params && typeof record.params === "object"
      ? (record.params as Record<string, unknown>)
      : {};

  const hasId = "id" in record;
  const requestId = hasId
    ? String(record.id)
    : null;

  void dispatchHostMethod(method, params)
    .then((result) => {
      if (requestId) {
        void respondExtension(
          extensionId,
          requestId,
          result,
          null,
        );
      }
    })
    .catch((error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      if (requestId) {
        void respondExtension(
          extensionId,
          requestId,
          null,
          {
            code: -32603,
            message: errorMessage,
            data: null,
          },
        );
      } else {
        console.error(
          `[Mocu Extension] ${method} failed:`,
          error,
        );
      }
    });
}

async function dispatchHostMethod(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case "mocu.log": {
      const level =
        typeof params.level === "string"
          ? params.level
          : "info";
      const logMessage =
        typeof params.message === "string"
          ? params.message
          : "";

      if (level === "error") {
        console.error(
          `[Mocu Extension] ${logMessage}`,
        );
      } else if (level === "warn") {
        console.warn(
          `[Mocu Extension] ${logMessage}`,
        );
      } else {
        console.log(
          `[Mocu Extension] ${logMessage}`,
        );
      }

      return null;
    }

    case "mocu.showMessage": {
      const messageText =
        typeof params.message === "string"
          ? params.message
          : "Extension message";
      const type =
        typeof params.type === "string"
          ? params.type
          : "info";

      const kind: "info" | "warning" | "error" =
        type === "warning"
          ? "warning"
          : type === "error"
            ? "error"
            : "info";

      await message(messageText, {
        kind,
      });

      return null;
    }

    case "mocu.emitEvent": {
      const event =
        typeof params.event === "string"
          ? params.event
          : "";

      if (event) {
        window.dispatchEvent(
          new CustomEvent(event, {
            detail: params.payload,
          }),
        );
      }

      return null;
    }

    case "mocu.getSettings": {
      return await readSettings();
    }

    case "mocu.updateSettings": {
      const current = await readSettings();
      const incoming =
        params.settings &&
        typeof params.settings === "object"
          ? (params.settings as Record<string, unknown>)
          : {};

      await saveSettings({
        ...current,
        ...incoming,
      });

      return null;
    }

    /*
     * Expose the LLM to extensions through Rust:
     * reservation = call `mocu.llm.generate` with a text prompt.
     */
    case "mocu.llm.generate": {
      const prompt =
        typeof params.prompt === "string"
          ? params.prompt.trim()
          : "";

      if (!prompt) {
        throw new Error(
          "mocu.llm.generate requires a 'prompt' parameter.",
        );
      }

      return await chatWithMocu(prompt);
    }

    default:
      throw new Error(
        `Unknown Mocu host method: ${method}`,
      );
  }
}

/**
 * Register the app-side host handler so extension-initiated requests
 * (like using the LLM model) are handled and answered.
 */
export function registerExtensionHost(): void {
  setExtensionMessageHandler(handleHostMessage);
}