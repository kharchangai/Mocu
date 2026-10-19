import { listen } from "@tauri-apps/api/event";

import { generateSimpleAnswer } from "../../services/ai";
import { generateSpeech, transcribeAudio } from "../../services/aiService";

import { getJevDecision } from "../../services/ai/tools/decision/Jev_model";

import { TextSimilarity } from "../../services/ai/tools/textSimilarity";
import { summarizeTextTool } from "../../services/ai/tools/summarize-text-tool";
import { extractEntitiesTool } from "../../services/ai/tools/extract-entities-tool";
import { dispatchAgentToolActivity } from "../../chat/services/toolActivity";
import { cancelExtensionAgentRun, handleAgentRun, handleAgentsList } from "./extension-agent-host";
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
const MAX_SUMMARIZE_TEXT_LENGTH = 100_000;
const MAX_SUMMARIZE_INSTRUCTIONS_LENGTH = 20_000;
const MAX_EXTRACT_TEXT_LENGTH = 100_000;
const MAX_EXTRACT_ENTITY_TYPES = 64;
const MAX_DECISION_QUESTIONS = 32;
const MAX_EMBEDDING_TEXTS = 64;
const MAX_EMBEDDING_TEXT_LENGTH = 32_000;
const MAX_TTS_TEXT_LENGTH = 20_000;
const MAX_STT_AUDIO_BASE64_LENGTH = 40_000_000; // ~30 MB decoded audio

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
 * include AI services, user-agent discovery/invocation, and
 * `mocu.extension.interact`, which pauses an interactive command until the user responds in chat.
 * Replies are written back into the extension via Rust.
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
      cancelExtensionAgentRun(extensionId, interactionRequestId);
      cancelExtensionInteraction(extensionId, interactionRequestId);
    }
    return;
  }

  if (method === "mocu.summarize.text") {
    await handleSummarizeText(extensionId, requestId, params);
    return;
  }

  if (method === "mocu.extract.entities") {
    await handleExtractEntities(extensionId, requestId, params);
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

  if (method === "mocu.stt.transcribe") {
    await handleSttTranscribe(extensionId, requestId, params);
    return;
  }

  if (method === "mocu.tts.speak") {
    await handleTtsSpeak(extensionId, requestId, params);
    return;
  }

  if (method === "mocu.agents.list") {
    await handleAgentsList(extensionId, requestId);
    return;
  }

  if (method === "mocu.agents.run") {
    await handleAgentRun(extensionId, requestId, params);
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

    const model =
    typeof params.model === "string" && params.model.trim()
      ? params.model.trim()
      : undefined;

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
      model,
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
 * Handle `mocu.summarize.text` using Mocu's separately configured Summarize LLM.
 */
async function handleSummarizeText(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) {
      throw new Error("mocu.summarize.text requires non-empty 'text'.");
    }
    if (text.length > MAX_SUMMARIZE_TEXT_LENGTH) {
      throw new Error(
        `mocu.summarize.text text is too long (maximum ${MAX_SUMMARIZE_TEXT_LENGTH} characters).`,
      );
    }

    const instructions =
      typeof params.instructions === "string"
        ? params.instructions.trim()
        : undefined;
    if (
      instructions &&
      instructions.length > MAX_SUMMARIZE_INSTRUCTIONS_LENGTH
    ) {
      throw new Error(
        `mocu.summarize.text instructions are too long (maximum ${MAX_SUMMARIZE_INSTRUCTIONS_LENGTH} characters).`,
      );
    }

    const summary = await summarizeTextTool.invoke({ text, instructions });
    if (requestId !== null) {
      await respondExtension(extensionId, requestId, { summary }, null);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Mocu Extension] mocu.summarize.text failed for '${extensionId}':`,
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

/** Handle `mocu.extract.entities` using Mocu's configured Extract LLM. */
async function handleExtractEntities(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const text = typeof params.text === "string" ? params.text.trim() : "";
    if (!text) throw new Error("mocu.extract.entities requires non-empty 'text'.");
    if (text.length > MAX_EXTRACT_TEXT_LENGTH) {
      throw new Error(`mocu.extract.entities text is too long (maximum ${MAX_EXTRACT_TEXT_LENGTH} characters).`);
    }

    const entities = params.entities;
    if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
      throw new Error("mocu.extract.entities requires an 'entities' object of name-to-description pairs.");
    }
    const entries = Object.entries(entities as Record<string, unknown>);
    if (!entries.length || entries.length > MAX_EXTRACT_ENTITY_TYPES) {
      throw new Error(`mocu.extract.entities requires between 1 and ${MAX_EXTRACT_ENTITY_TYPES} entity definitions.`);
    }
    const entityDefinitions: Record<string, string> = {};
    for (const [name, description] of entries) {
      if (!name.trim() || typeof description !== "string" || !description.trim()) {
        throw new Error("Each entity must have a non-empty name and description.");
      }
      entityDefinitions[name] = description.trim();
    }

    const rawThreshold = params.threshold;
    if (rawThreshold !== undefined && (typeof rawThreshold !== "number" || !Number.isFinite(rawThreshold) || rawThreshold < 0 || rawThreshold > 1)) {
      throw new Error("mocu.extract.entities threshold must be a number from 0 to 1.");
    }
    const threshold = typeof rawThreshold === "number" ? rawThreshold : undefined;
    const rawTopN = params.top_n;
    if (rawTopN !== undefined && (typeof rawTopN !== "number" || !Number.isInteger(rawTopN) || rawTopN < 1 || rawTopN > 10_000)) {
      throw new Error("mocu.extract.entities top_n must be a positive integer no greater than 10000.");
    }
    const top_n = typeof rawTopN === "number" ? rawTopN : undefined;

    const result = await extractEntitiesTool.invoke({ text, entities: entityDefinitions, threshold, top_n });
    if (requestId !== null) await respondExtension(extensionId, requestId, result, null);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Mocu Extension] mocu.extract.entities failed for '${extensionId}':`, error);
    if (requestId !== null) {
      await respondExtension(extensionId, requestId, null, { code: -32603, message: errorMessage, data: null });
    }
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
 * Handle `mocu.stt.transcribe`: transcribe base64-encoded audio with Mocu's
 * configured STT model (settings: model / base URL / API key) and return
 * the recognized text.
 */
async function handleSttTranscribe(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const audio = params.audio;

    if (typeof audio !== "string" || !audio.trim()) {
      throw new Error(
        "mocu.stt.transcribe requires a non-empty base64 'audio' string.",
      );
    }

    if (audio.length > MAX_STT_AUDIO_BASE64_LENGTH) {
      throw new Error(
        `mocu.stt.transcribe audio is too large (maximum ${MAX_STT_AUDIO_BASE64_LENGTH} base64 characters).`,
      );
    }

    const mimeType =
      typeof params.mimeType === "string" && params.mimeType.trim()
        ? params.mimeType.trim()
        : "audio/webm";

    const audioBlob = base64ToBlob(audio, mimeType);

    const text = await transcribeAudio(audioBlob);

    if (requestId !== null) {
      await respondExtension(extensionId, requestId, { text }, null);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      `[Mocu Extension] mocu.stt.transcribe failed for '${extensionId}':`,
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
 * Handle `mocu.tts.speak`: synthesize text with Mocu's configured TTS
 * model and voice (settings) and return base64 audio to the extension.
 */
async function handleTtsSpeak(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  try {
    const text = params.text;

    if (typeof text !== "string" || !text.trim()) {
      throw new Error("mocu.tts.speak requires a non-empty 'text' string.");
    }

    if (text.length > MAX_TTS_TEXT_LENGTH) {
      throw new Error(
        `mocu.tts.speak text is too long (maximum ${MAX_TTS_TEXT_LENGTH} characters).`,
      );
    }

    const audioBlob = await generateSpeech(text);

    const audioBase64 = await blobToBase64(audioBlob);

    if (requestId !== null) {
      await respondExtension(extensionId, requestId, {
        audio: audioBase64,
        mimeType: audioBlob.type || "audio/mpeg",
      }, null);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(
      `[Mocu Extension] mocu.tts.speak failed for '${extensionId}':`,
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
 * Decode a base64 string into a Blob for the STT pipeline.
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

/**
 * Encode a Blob (e.g. synthesized TTS audio) into a base64 string.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let binary = "";

  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
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
