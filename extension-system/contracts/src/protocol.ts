import { LLM_GENERATE_METHOD } from "./llm.js";

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
} as const;