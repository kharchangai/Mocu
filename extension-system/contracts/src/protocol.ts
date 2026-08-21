export type JsonRpcId =
  | string
  | number;

export interface JsonRpcRequest<
  TParams = unknown,
> {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotification<
  TParams = unknown,
> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<
  TResult = unknown,
> {
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

export interface ExtensionInitializeParams {
  extensionId: string;
  extensionPath: string;
  appDataPath: string;
  appVersion: string;
  platform: string;
  architecture: string;
  configuration: Record<string, unknown>;
}

export interface ExtensionInitializeResult {
  initialized: boolean;
}

export interface ExtensionActivateParams {
  reason: "startup" | "manual" | "reload";
}

export interface ExtensionActivateResult {
  activated: boolean;
}

export interface ExtensionDeactivateParams {
  reason:
    | "shutdown"
    | "disable"
    | "reload"
    | "uninstall";
}

export interface ExtensionDeactivateResult {
  deactivated: boolean;
}

export interface ExtensionExecuteParams {
  command: string;
  input?: unknown;
  context?: Record<string, unknown>;
}

export interface ExtensionExecuteResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface MocuLogParams {
  level:
    | "debug"
    | "info"
    | "warn"
    | "error";

  message: string;
  data?: unknown;
}

export interface MocuShowMessageParams {
  type:
    | "info"
    | "warning"
    | "error";

  message: string;
}

export interface MocuEmitEventParams {
  event: string;
  payload?: unknown;
}

export const EXTENSION_METHODS = {
  initialize: "extension.initialize",
  activate: "extension.activate",
  deactivate: "extension.deactivate",
  execute: "extension.execute",
  ping: "extension.ping",
} as const;

export const HOST_METHODS = {
  log: "mocu.log",
  showMessage: "mocu.showMessage",
  emitEvent: "mocu.emitEvent",
  getSettings: "mocu.getSettings",
  updateSettings: "mocu.updateSettings",
} as const;