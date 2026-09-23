import { EXTENSION_METHODS } from "@mocu/extension-contracts";

import type { ExtensionExecuteParams } from "@mocu/extension-contracts";

import { LlmApi } from "./llm.js";
import { DecisionApi } from "./decision.js";
import { EmbeddingApi } from "./embedding.js";
import { ExtensionUiApi } from "./ui.js";
import { JsonRpcProtocolClient } from "./protocol-client.js";

import type {
  ExtensionCommandHandler,
  ExtensionConfig,
  MocuExtensionDefinition,
} from "./types.js";

/**
 * The minimal Mocu extension SDK. An extension just registers command
 * handlers and calls `start()`; Mocu invokes the requested command on demand
 * via `extension.execute`. Extensions may also call host AI APIs and request
 * user interaction in Mocu chat through the execution context.
 */
export class MocuExtension {
  private readonly protocol = new JsonRpcProtocolClient();
  private readonly commands = new Map<string, ExtensionCommandHandler>();

  /** Call the Mocu host LLM from inside a command. */
  public readonly llm: LlmApi;

  /** Ask typed probabilistic questions via the Jev decision model. */
  public readonly decision: DecisionApi;

  /** Create embedding vectors with Mocu's configured embedding model. */
  public readonly embedding: EmbeddingApi;

  public constructor(
    private readonly definition: MocuExtensionDefinition = {},
  ) {
    this.llm = new LlmApi(this.protocol);
    this.decision = new DecisionApi(this.protocol);
    this.embedding = new EmbeddingApi(this.protocol);

    for (const [command, handler] of Object.entries(definition.commands ?? {})) {
      this.commands.set(command, handler);
    }

    this.protocol.registerRequestHandler(
      EXTENSION_METHODS.execute,
      async (params) => this.executeCommand(params as ExtensionExecuteParams),
    );
  }

  public registerCommand(
    command: string,
    handler: ExtensionCommandHandler,
  ): void {
    const normalizedCommand = command.trim();

    if (!normalizedCommand) {
      throw new Error("Command name cannot be empty.");
    }

    if (this.commands.has(normalizedCommand)) {
      throw new Error(`Command is already registered: ${normalizedCommand}`);
    }

    this.commands.set(normalizedCommand, handler);
  }

  public start(): void {
    this.protocol.start();
  }

  /** Send a one-way JSON-RPC notification to the Mocu host. */
  public notify(method: string, params?: unknown): void {
    this.protocol.notify(method, params);
  }

  private async executeCommand(
    params: ExtensionExecuteParams,
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    try {
      let output: unknown;
      const rawContext =
        params.context && typeof params.context === "object"
          ? (params.context as Record<string, unknown>)
          : {};
      const context = {
        ...rawContext,
        mocu: {
          ui: new ExtensionUiApi(
            this.protocol,
            params.command,
            rawContext,
          ),
        },
      };
      const executionParams = { ...params, context };

      if (this.definition.execute) {
        output = await this.definition.execute(executionParams);
      } else {
        const handler = this.commands.get(params.command);

        if (!handler) {
          return {
            success: false,
            error: `Unknown command: ${params.command}`,
          };
        }

        const config: ExtensionConfig =
          params.config && typeof params.config === "object"
            ? (params.config as ExtensionConfig)
            : {};

        output = await handler(
          params.input,
          context,
          config,
        );
      }

      return { success: true, output };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export const createExtension = (
  definition: MocuExtensionDefinition = {},
): MocuExtension => new MocuExtension(definition);

export default MocuExtension;