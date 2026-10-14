import { EXTENSION_METHODS } from "@mocu/extension-contracts";
import { AgentsApi } from "./agents.js";
import { DecisionApi } from "./decision.js";
import { EmbeddingApi } from "./embedding.js";
import { LlmApi } from "./llm.js";
import { ExtensionUiApi } from "./ui.js";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/**
 * The minimal Mocu extension SDK. An extension registers command handlers and
 * calls `start()`; Mocu invokes commands on demand via `extension.execute`.
 * Extensions may call host AI APIs, interact with the user, and run saved user
 * agents through the host without bundling a model of their own.
 */
export class MocuExtension {
    definition;
    protocol = new JsonRpcProtocolClient();
    commands = new Map();
    /** Call the Mocu host LLM from inside a command. */
    llm;
    /** Ask typed probabilistic questions via the Jev decision model. */
    decision;
    /** Create embedding vectors with Mocu's configured embedding model. */
    embedding;
    /** Discover and invoke the current user's saved agents. */
    agents;
    constructor(definition = {}) {
        this.definition = definition;
        this.llm = new LlmApi(this.protocol);
        this.decision = new DecisionApi(this.protocol);
        this.embedding = new EmbeddingApi(this.protocol);
        this.agents = new AgentsApi(this.protocol);
        for (const [command, handler] of Object.entries(definition.commands ?? {})) {
            this.commands.set(command, handler);
        }
        this.protocol.registerRequestHandler(EXTENSION_METHODS.execute, async (params) => this.executeCommand(params));
    }
    registerCommand(command, handler) {
        const normalizedCommand = command.trim();
        if (!normalizedCommand) {
            throw new Error("Command name cannot be empty.");
        }
        if (this.commands.has(normalizedCommand)) {
            throw new Error(`Command is already registered: ${normalizedCommand}`);
        }
        this.commands.set(normalizedCommand, handler);
    }
    start() {
        this.protocol.start();
    }
    /** Send a one-way JSON-RPC notification to the Mocu host. */
    notify(method, params) {
        this.protocol.notify(method, params);
    }
    async executeCommand(params) {
        try {
            let output;
            const rawContext = params.context && typeof params.context === "object"
                ? params.context
                : {};
            const context = {
                ...rawContext,
                mocu: {
                    ui: new ExtensionUiApi(this.protocol, params.command, rawContext),
                },
            };
            const executionParams = { ...params, context };
            if (this.definition.execute) {
                output = await this.definition.execute(executionParams);
            }
            else {
                const handler = this.commands.get(params.command);
                if (!handler) {
                    return {
                        success: false,
                        error: `Unknown command: ${params.command}`,
                    };
                }
                const config = params.config && typeof params.config === "object"
                    ? params.config
                    : {};
                output = await handler(params.input, context, config);
            }
            return { success: true, output };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
}
export const createExtension = (definition = {}) => new MocuExtension(definition);
export default MocuExtension;
//# sourceMappingURL=extension.js.map