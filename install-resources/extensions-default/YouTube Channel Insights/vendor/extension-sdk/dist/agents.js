import { HOST_METHODS } from "@mocu/extension-contracts";
/** Lets extension authors discover and invoke agents saved by the current user. */
export class AgentsApi {
    client;
    constructor(client) {
        this.client = client;
    }
    /** List the user's saved agents. Only public metadata is returned. */
    async list() {
        return this.client.request(HOST_METHODS.agentsList);
    }
    /** Run one saved agent and await its text response. */
    async run(params, options = {}) {
        if (!params || typeof params.agentId !== "string" || !params.agentId.trim()) {
            throw new Error("Agent run requires a non-empty agentId.");
        }
        if (typeof params.input !== "string" || !params.input.trim()) {
            throw new Error("Agent run requires a non-empty input string.");
        }
        return this.client.request(HOST_METHODS.agentsRun, {
            agentId: params.agentId.trim(),
            input: params.input.trim(),
        }, options.timeoutMs ?? null, options.signal);
    }
}
//# sourceMappingURL=agents.js.map