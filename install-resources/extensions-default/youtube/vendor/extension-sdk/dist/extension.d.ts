import { LlmApi } from "./llm.js";
import { DecisionApi } from "./decision.js";
import { EmbeddingApi } from "./embedding.js";
import type { ExtensionCommandHandler, MocuExtensionDefinition } from "./types.js";
/**
 * The minimal Mocu extension SDK. An extension just registers command
 * handlers and calls `start()`; Mocu invokes the requested command on demand
 * via `extension.execute`. Extensions may also call host AI APIs and request
 * user interaction in Mocu chat through the execution context.
 */
export declare class MocuExtension {
    private readonly definition;
    private readonly protocol;
    private readonly commands;
    /** Call the Mocu host LLM from inside a command. */
    readonly llm: LlmApi;
    /** Ask typed probabilistic questions via the Jev decision model. */
    readonly decision: DecisionApi;
    /** Create embedding vectors with Mocu's configured embedding model. */
    readonly embedding: EmbeddingApi;
    constructor(definition?: MocuExtensionDefinition);
    registerCommand(command: string, handler: ExtensionCommandHandler): void;
    start(): void;
    /** Send a one-way JSON-RPC notification to the Mocu host. */
    notify(method: string, params?: unknown): void;
    private executeCommand;
}
export declare const createExtension: (definition?: MocuExtensionDefinition) => MocuExtension;
export default MocuExtension;
//# sourceMappingURL=extension.d.ts.map