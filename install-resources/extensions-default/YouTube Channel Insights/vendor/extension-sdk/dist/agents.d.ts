import type { AgentDescriptor, AgentRunParams, AgentRunResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/** Lets extension authors discover and invoke agents saved by the current user. */
export declare class AgentsApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    /** List the user's saved agents. Only public metadata is returned. */
    list(): Promise<AgentDescriptor[]>;
    /** Run one saved agent and await its text response. */
    run(params: AgentRunParams, options?: {
        timeoutMs?: number | null;
        signal?: AbortSignal;
    }): Promise<AgentRunResult>;
}
//# sourceMappingURL=agents.d.ts.map