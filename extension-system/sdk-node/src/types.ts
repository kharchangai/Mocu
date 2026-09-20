import type {
  ExtensionExecuteParams,
} from "@mocu/extension-contracts";

export type MaybePromise<T> = T | Promise<T>;

/**
 * User-filled values for the manifest's `config` fields (API keys, URLs,
 * ...). Empty object when the extension declares no config fields or the
 * user has not filled anything in yet.
 */
export type ExtensionConfig = Record<string, unknown>;

/**
 * A command handler. Receives the caller-supplied input, an optional
 * context object, and the user-filled config values, and returns whatever
 * the extension wants to send back.
 */
export type ExtensionCommandHandler = (
  input: unknown,
  context: Record<string, unknown>,
  config: ExtensionConfig,
) => MaybePromise<unknown>;

/**
 * Everything an extension can declare. Extensions simply provide one or more
 * command handlers; Mocu calls the requested command on demand.
 */
export interface MocuExtensionDefinition {
  commands?: Record<string, ExtensionCommandHandler>;
  execute?: (
    params: ExtensionExecuteParams,
  ) => MaybePromise<unknown>;
}

/**
 * A host request awaiting its response inside the protocol client.
 */
export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}
