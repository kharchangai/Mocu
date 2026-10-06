import { HOST_METHODS } from "@mocu/extension-contracts";

import type {
  ExtensionInteractionButton,
  ExtensionInteractionParams,
  ExtensionInteractionResult,
} from "@mocu/extension-contracts";

import type { JsonRpcProtocolClient } from "./protocol-client.js";

export type ExtensionInteractionOptions = Omit<
  ExtensionInteractionParams,
  "command" | "context"
>;

/**
 * Chat UI APIs available to an extension command. Each prompt waits until the
 * user submits text or clicks one of its declared buttons.
 */
export class ExtensionUiApi {
  public constructor(
    private readonly protocol: JsonRpcProtocolClient,
    private readonly command: string,
    private readonly context: Record<string, unknown>,
  ) {}

  public interact(
    options: ExtensionInteractionOptions,
    signal?: AbortSignal,
  ): Promise<ExtensionInteractionResult> {
    return this.protocol.request<ExtensionInteractionResult>(
      HOST_METHODS.extensionInteract,
      {
        command: this.command,
        context: this.context,
        ...options,
      } satisfies ExtensionInteractionParams,
      null,
      signal,
    );
  }
}

export type { ExtensionInteractionButton, ExtensionInteractionResult };
