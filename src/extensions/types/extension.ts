export type ExtensionRuntime = "node" | "python";

export interface ExtensionCommand {
  id: string;
  title: string;
  description?: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: ExtensionRuntime;
  entry: string;
  commands?: ExtensionCommand[];
}

export interface InstalledExtension {
  path: string;
  manifestPath: string;
  manifest: ExtensionManifest;
}

export interface ExtensionStartResult {
  extensionId: string;
  started: boolean;
}

export interface ExtensionStatus {
  extensionId: string;
  running: boolean;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string;
  result: T;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: JsonRpcErrorObject;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage<T = unknown> =
  | JsonRpcRequest
  | JsonRpcSuccessResponse<T>
  | JsonRpcErrorResponse
  | JsonRpcNotification;

export interface ExtensionMessageEvent {
  extensionId: string;
  message: JsonRpcMessage;
}

export interface ExtensionLogEvent {
  extensionId: string;
  level: string;
  message: string;
}

export interface ExtensionExitEvent {
  extensionId: string;
}