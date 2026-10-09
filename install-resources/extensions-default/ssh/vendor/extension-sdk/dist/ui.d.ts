import type { ExtensionInteractionButton, ExtensionInteractionParams, ExtensionInteractionResult } from "@mocu/extension-contracts";
import type { JsonRpcProtocolClient } from "./protocol-client.js";
export type ExtensionInteractionOptions = Omit<ExtensionInteractionParams, "command" | "context">;
/**
 * Chat UI APIs available to an extension command. Each prompt waits until the
 * user submits text or clicks one of its declared buttons.
 */
export declare class ExtensionUiApi {
    private readonly protocol;
    private readonly command;
    private readonly context;
    constructor(protocol: JsonRpcProtocolClient, command: string, context: Record<string, unknown>);
    interact(options: ExtensionInteractionOptions, signal?: AbortSignal): Promise<ExtensionInteractionResult>;
}
export type { ExtensionInteractionButton, ExtensionInteractionResult };
//# sourceMappingURL=ui.d.ts.map