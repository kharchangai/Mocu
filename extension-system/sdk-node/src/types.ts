import type {
  ExtensionExecuteParams,
} from "@mocu/extension-contracts";

export type MaybePromise<T> = T | Promise<T>;

/**
 * A command handler. Receives the caller-supplied input and an optional
 * context object, and returns whatever the extension wants to send back.
 */
export type ExtensionCommandHandler = (
  input: unknown,
  context: Record<string, unknown>,
) => MaybePromise<unknown>;

/**
 * Everything an extension can declare. Extensions simply provide one or more
 * command handlers; Mocu calls the requested command on demand.
 */
export interface MocuExtensionDefinition {
  commands?: Record<string, ExtensionCommandHandler>;
  execute?: (params: ExtensionExecuteParams) => MaybePromise<unknown>;
}

/**
 * A host request awaiting its response inside the protocol client.
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
