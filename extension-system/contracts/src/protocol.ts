import { LLM_GENERATE_METHOD } from "./llm.js";
import { DECISION_ASK_METHOD } from "./decision.js";
import { EMBEDDING_EMBED_METHOD } from "./embedding.js";

export type JsonRpcId = string | number;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcErrorData {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: JsonRpcErrorData;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

/**
 * Parameters sent every time Mocu calls an extension.
 */
export interface ExtensionExecuteParams {
  command: string;
  input?: unknown;
  /**
   * Host-provided metadata (e.g. `toolCallId` / `toolName` for streaming
   * commands). Sent by the Rust host; empty object when absent.
   */
  context?: unknown;
  /**
   * Values the user filled in on the extension's card (manifest `config`
   * fields), e.g. API keys or URLs. Merged with declared defaults by the
   * host; absent when the manifest declares no config fields.
   */
  config?: unknown;
}

/**
 * The response an extension writes after handling an invocation.
 */
export interface ExtensionExecuteResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

/**
 * The single JSON-RPC method the extension system understands: run a command
 * with an input payload and return a result. There is no manual activate /
 * deactivate or initialize stage — extensions are simply called on demand.
 */
export const EXTENSION_METHODS = {
  execute: "extension.execute",
} as const;

/**
 * Host-side methods extensions may call back into. The host (Rust + frontend)
 * resolves these and returns a result.
 */
export const HOST_METHODS = {
  llmGenerate: LLM_GENERATE_METHOD,
  decisionAsk: DECISION_ASK_METHOD,
  embeddingEmbed: EMBEDDING_EMBED_METHOD,
  extensionInteract: "mocu.extension.interact",
  extensionInteractionCancel: "mocu.extension.interaction.cancel",
} as const;

/** Buttons an extension may display while waiting for user input. */
export interface ExtensionInteractionButton {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
}

/**
 * A one-shot interactive prompt. The extension waits for the user to submit
 * text or choose one of the declared buttons, then may display another prompt.
 */
export interface ExtensionInteractionParams {
  command: string;
  context?: unknown;
  title?: string;
  message?: string;
  input?: boolean;
  inputPlaceholder?: string;
  buttons?: ExtensionInteractionButton[];
}

export interface ExtensionInteractionResult {
  actionId: string;
  input?: string;
}