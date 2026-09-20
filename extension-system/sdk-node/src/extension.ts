import { EXTENSION_METHODS } from "@mocu/extension-contracts";

import type { ExtensionExecuteParams } from "@mocu/extension-contracts";

import { LlmApi } from "./llm.js";
import { DecisionApi } from "./decision.js";
import { EmbeddingApi } from "./embedding.js";
import { JsonRpcProtocolClient } from "./protocol-client.js";

import type {
  ExtensionCommandHandler,
  ExtensionConfig,
  MocuExtensionDefinition,
} from "./types.js";

/**
 * The minimal Mocu extension SDK. An extension just registers command
 * handlers and calls `start()`; Mocu invokes the requested command on demand
 * via `extension.execute`. Extensions may also call the host LLM through
 * `extension.llm.generate()`.
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

  private async executeCommand(
    params: ExtensionExecuteParams,
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    try {
      let output: unknown;

      if (this.definition.execute) {
        output = await this.definition.execute(params);
      } else {
        const handler = this.commands.get(params.command);

        if (!handler) {
          return {
            success: false,
            error: `Unknown command: ${params.command}`,
          };
        }

        const context: Record<string, unknown> =
          params.context && typeof params.context === "object"
            ? (params.context as Record<string, unknown>)
            : {};

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