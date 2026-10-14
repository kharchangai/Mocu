import { AgentsApi } from "./agents.js";
import { DecisionApi } from "./decision.js";
import { EmbeddingApi } from "./embedding.js";
import { LlmApi } from "./llm.js";
import type { ExtensionCommandHandler, MocuExtensionDefinition } from "./types.js";
/**
 * The minimal Mocu extension SDK. An extension registers command handlers and
 * calls `start()`; Mocu invokes commands on demand via `extension.execute`.
 * Extensions may call host AI APIs, interact with the user, and run saved user
 * agents through the host without bundling a model of their own.
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
    /** Discover and invoke the current user's saved agents. */
    readonly agents: AgentsApi;
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