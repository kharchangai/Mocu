import type {
  ExtensionActivateParams,
  ExtensionDeactivateParams,
  ExtensionExecuteParams,
  ExtensionInitializeParams,
} from "@mocu/extension-contracts";

export type MaybePromise<T> =
  | T
  | Promise<T>;

export type ExtensionCommandHandler = (
  input: unknown,
  context: Record<string, unknown>,
) => MaybePromise<unknown>;

export interface MocuExtensionDefinition {
  initialize?: (
    params: ExtensionInitializeParams,
  ) => MaybePromise<void>;

  activate?: (
    params: ExtensionActivateParams,
  ) => MaybePromise<void>;

  deactivate?: (
    params: ExtensionDeactivateParams,
  ) => MaybePromise<void>;

  commands?: Record<
    string,
    ExtensionCommandHandler
  >;

  execute?: (
    params: ExtensionExecuteParams,
  ) => MaybePromise<unknown>;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}