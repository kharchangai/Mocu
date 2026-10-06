import { HOST_METHODS } from "@mocu/extension-contracts";
import type {
  AgentDescriptor,
  AgentRunParams,
  AgentRunResult,
} from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";

/** Lets extension authors discover and invoke agents saved by the current user. */
export class AgentsApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  /** List the user's saved agents. Only public metadata is returned. */
  async list(): Promise<AgentDescriptor[]> {
    return this.client.request<AgentDescriptor[]>(HOST_METHODS.agentsList);
  }

  /** Run one saved agent and await its text response. */
  async run(
    params: AgentRunParams,
    options: { timeoutMs?: number | null; signal?: AbortSignal } = {},
  ): Promise<AgentRunResult> {
    if (!params || typeof params.agentId !== "string" || !params.agentId.trim()) {
      throw new Error("Agent run requires a non-empty agentId.");
    }
    if (typeof params.input !== "string" || !params.input.trim()) {
      throw new Error("Agent run requires a non-empty input string.");
    }

    return this.client.request<AgentRunResult>(
      HOST_METHODS.agentsRun,
      {
        agentId: params.agentId.trim(),
        input: params.input.trim(),
      },
      options.timeoutMs ?? null,
      options.signal,
    );
  }
}