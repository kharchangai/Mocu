export const AGENTS_LIST_METHOD = "mocu.agents.list" as const;
export const AGENTS_RUN_METHOD = "mocu.agents.run" as const;

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
