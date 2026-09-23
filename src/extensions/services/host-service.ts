import { listen } from "@tauri-apps/api/event";

import { generateSimpleAnswer } from "../../services/ai";

import { getJevDecision } from "../../services/ai/tools/decision/Jev_model";

import { TextSimilarity } from "../../services/ai/tools/textSimilarity";

import { dispatchAgentToolActivity } from "../../chat/services/toolActivity";

import { respondExtension } from "./extension-client";
import { scanInstalledExtensions } from "./extension-scanner";
import { getActiveRequestChatId } from "../../chat/services/activeChatSession";
import {
  cancelExtensionInteraction,
  getExtensionInteraction,
  setExtensionInteraction,
} from "./extension-interaction-store";
import type { ExtensionInteractionButton } from "../types/extension-interaction";

const MAX_LLM_PROMPT_LENGTH = 100_000;
const MAX_LLM_SYSTEM_PROMPT_LENGTH = 20_000;
const MAX_DECISION_QUESTIONS = 32;
const MAX_EMBEDDING_TEXTS = 64;
const MAX_EMBEDDING_TEXT_LENGTH = 32_000;

/**
 * Handle one-way progress notifications streamed by extensions while a
 * command runs ("mocu.extension.activity"). The payload identifies the
 * chat tool card (toolCallId + toolName, passed through the command
 * context) and carries the accumulated output text so far; dispatching it
 * as a tool-activity update live-refreshes that card in the chat.
 */
function handleActivityNotification(
  extensionId: string,
  params: Record<string, unknown>,
): void {
  const toolCallId = params.toolCallId;
  const text = params.text;

  if (typeof toolCallId !== "string" || !toolCallId) {
    return;
  }

  const toolName =
    typeof params.toolName === "string" && params.toolName
      ? params.toolName
      : `extension_${extensionId}`;

  dispatchAgentToolActivity({
    id: toolCallId,
    tool: toolName,
    status: "running",
    streaming: true,
    streamLog:
      typeof text === "string"
        ? text
        : "",
  });
}

/**
 * Handle host-bound JSON-RPC requests that extensions send toward Mocu.
 *
 * Rust forwards these as `extension://message` events. Supported host methods
 * include AI services and `mocu.extension.interact`, which pauses an
 * interactive command until the user responds in chat. Replies are written
 * back into the extension via Rust.
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

  if (method === "mocu.extension.activity") {
    // One-way progress stream; never answered.
    handleActivityNotification(extensionId, params);
    return;
  }

  if (method === "mocu.extension.interact") {
    await handleExtensionInteraction(extensionId, requestId, params);
    return;
  }

  if (method === "mocu.extension.interaction.cancel") {
    const interactionRequestId = params.requestId;
    if (
      typeof interactionRequestId === "string" ||
      typeof interactionRequestId === "number"
    ) {
      cancelExtensionInteraction(extensionId, interactionRequestId);
    }
    return;
  }

  if (method === "mocu.decision.ask") {
    await handleDecisionAsk(extensionId, requestId, params);
    return;
  }

  if (method === "mocu.embedding.embed") {
    await handleEmbeddingEmbed(extensionId, requestId, params);
    return;
  }

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
 * Publish a chat interaction requested by an extension and keep its JSON-RPC
 * request pending until the user submits text or clicks one of its buttons.
 */
async function handleExtensionInteraction(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  if (requestId === null) {
    return;
  }

  const fail = async (message: string): Promise<void> => {
    await respondExtension(extensionId, requestId, null, {
      code: -32602,
      message,
      data: null,
    });
  };

  try {
    const command = typeof params.command === "string" ? params.command : "";
    const context =
      params.context &&
      typeof params.context === "object" &&
      !Array.isArray(params.context)
        ? (params.context as Record<string, unknown>)
        : {};
    const chatId =
      typeof context.chatId === "string" && context.chatId.trim()
        ? context.chatId.trim()
        : getActiveRequestChatId();

    if (!command || !chatId) {
      await fail(
        "Interactive extension commands need a command and active chat context.",
      );
      return;
    }

    const installed = await scanInstalledExtensions();
    const extension = installed.find((entry) => entry.manifest.id === extensionId);
    const declaration = extension?.manifest.commands?.find(
      (entry) => entry.id === command,
    );

    if (!declaration?.interactive) {
      await fail(
        `Extension command '${command}' must declare \"interactive\": true in its manifest.`,
      );
      return;
    }

    const rawButtons = Array.isArray(params.buttons) ? params.buttons : [];
    if (rawButtons.length > 8) {
      await fail("An extension interaction can show at most 8 buttons.");
      return;
    }

    const seenButtonIds = new Set<string>();
    const buttons: ExtensionInteractionButton[] = rawButtons.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }
      const button = value as Record<string, unknown>;
      if (
        typeof button.id !== "string" ||
        !button.id.trim() ||
        typeof button.label !== "string" ||
        !button.label.trim()
      ) {
        return [];
      }

      const id = button.id.trim().slice(0, 64);
      if (seenButtonIds.has(id)) {
        return [];
      }
      seenButtonIds.add(id);

      const variant =
        button.variant === "primary" || button.variant === "danger"
          ? button.variant
          : "secondary";
      return [{
        id,
        label: button.label.trim().slice(0, 80),
        variant,
      }];
    });
    const inputEnabled = params.input === true;

    if (!inputEnabled && buttons.length === 0) {
      await fail(
        "An interaction must enable text input or declare at least one button.",
      );
      return;
    }

    const activeInteraction = getExtensionInteraction(chatId);
    if (activeInteraction && !activeInteraction.isResponding) {
      await fail(
        "This chat already has an extension waiting for a reply.",
      );
      return;
    }

    const wasPublished = setExtensionInteraction({
      extensionId,
      extensionName: extension?.manifest.name ?? extensionId,
      requestId,
      chatId,
      command,
      title:
        typeof params.title === "string"
          ? params.title.slice(0, 120)
          : "Extension needs your input",
      message: typeof params.message === "string" ? params.message.slice(0, 4_000) : "",
      inputEnabled,
      inputPlaceholder:
        typeof params.inputPlaceholder === "string"
          ? params.inputPlaceholder.slice(0, 240)
          : "Reply to the extension…",
      buttons,
      isResponding: false,
    });

    if (!wasPublished) {
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await fail(message);
  }
}

/**
 * Handle `mocu.decision.ask`: forward a typed question set to Mocu's
 * configured Jev decision model (OpenRouter Decisions API) and pass the
 * raw result back to the extension. The model does not generate text; it
 * answers with calibrated probabilities (noul / choice / score).
 */
async function handleDecisionAsk(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const state = params.state;

    if (state === undefined || state === null) {
      throw new Error(
        "mocu.decision.ask requires a 'state' to reason about.",
      );
    }

    const questions = params.questions;

    if (
      !questions ||
      typeof questions !== "object" ||
      Array.isArray(questions) ||
      Object.keys(questions).length === 0
    ) {
      throw new Error(
        "mocu.decision.ask requires a non-empty 'questions' object.",
      );
    }

    if (Object.keys(questions).length > MAX_DECISION_QUESTIONS) {
      throw new Error(
        `mocu.decision.ask allows at most ${MAX_DECISION_QUESTIONS} questions per call.`,
      );
    }

    const result = await getJevDecision({
      state,
      questions: questions as Parameters<
        typeof getJevDecision
      >[0]["questions"],
    });

    if (requestId !== null) {
      await respondExtension(extensionId, requestId, result, null);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      `[Mocu Extension] mocu.decision.ask failed for '${extensionId}':`,
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
 * Handle `mocu.embedding.embed`: embed one or more texts with Mocu's
 * configured embedding model (settings: model / base URL / API key) and
 * return one vector per input text, in order.
 */
async function handleEmbeddingEmbed(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const texts = params.texts;

    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error(
        "mocu.embedding.embed requires a non-empty 'texts' array.",
      );
    }

    if (texts.length > MAX_EMBEDDING_TEXTS) {
      throw new Error(
        `mocu.embedding.embed allows at most ${MAX_EMBEDDING_TEXTS} texts per call.`,
      );
    }

    for (const [index, text] of texts.entries()) {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error(
          `mocu.embedding.embed texts[${index}] must be a non-empty string.`,
        );
      }

      if (text.length > MAX_EMBEDDING_TEXT_LENGTH) {
        throw new Error(
          `mocu.embedding.embed texts[${index}] is too long (maximum ${MAX_EMBEDDING_TEXT_LENGTH} characters).`,
        );
      }
    }

    const similarity = new TextSimilarity();

    const embeddings = await similarity.embedTexts(
      texts as string[],
    );

    if (requestId !== null) {
      await respondExtension(extensionId, requestId, { embeddings }, null);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      `[Mocu Extension] mocu.embedding.embed failed for '${extensionId}':`,
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
 * app so extensions can call Mocu host methods, including interactive chat
 * requests. Returns a cleanup function.
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
