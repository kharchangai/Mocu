import { LLM_GENERATE_METHOD } from "./llm.js";
import { DECISION_ASK_METHOD } from "./decision.js";
import { EMBEDDING_EMBED_METHOD } from "./embedding.js";
import { AGENTS_LIST_METHOD, AGENTS_RUN_METHOD } from "./agents.js";
/**
 * The single JSON-RPC method the extension system understands: run a command
 * with an input payload and return a result. There is no manual activate /
 * deactivate or initialize stage — extensions are simply called on demand.
 */
export const EXTENSION_METHODS = {
    execute: "extension.execute",
};
/**
 * Host-side methods extensions may call back into. The host (Rust + frontend)
 * resolves these and returns a result.
 */
export const HOST_METHODS = {
    llmGenerate: LLM_GENERATE_METHOD,
    decisionAsk: DECISION_ASK_METHOD,
    embeddingEmbed: EMBEDDING_EMBED_METHOD,
    agentsList: AGENTS_LIST_METHOD,
    agentsRun: AGENTS_RUN_METHOD,
    extensionInteract: "mocu.extension.interact",
    extensionInteractionCancel: "mocu.extension.interaction.cancel",
};
//# sourceMappingURL=protocol.js.map