export declare const AGENTS_LIST_METHOD: "mocu.agents.list";
export declare const AGENTS_RUN_METHOD: "mocu.agents.run";
/** Public, non-secret metadata for an agent saved by the current Mocu user. */
export interface AgentDescriptor {
    id: string;
    name: string;
    description: string;
}
export interface AgentRunParams {
    agentId: string;
    input: string;
}
/** Result returned after the saved agent has completed its run. */
export interface AgentRunResult {
    agentId: string;
    name: string;
    text: string;
}
//# sourceMappingURL=agents.d.ts.map