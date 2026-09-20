import type {
  DecisionAskParams,
  DecisionAskResult,
} from "@mocu/extension-contracts";

import { DECISION_ASK_METHOD } from "@mocu/extension-contracts";

import { JsonRpcProtocolClient } from "./protocol-client.js";

/**
 * Lets an extension ask typed probabilistic questions through Mocu's
 * configured Jev decision model (OpenRouter Decisions API).
 */
export class DecisionApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  async ask(
    params: DecisionAskParams,
  ): Promise<DecisionAskResult> {
    if (!params) {
      throw new Error("Decision ask requires params.");
    }

    if (params.state === undefined || params.state === null) {
      throw new Error("Decision ask requires a 'state' to reason about.");
    }

    if (
      !params.questions ||
      typeof params.questions !== "object" ||
      Array.isArray(params.questions) ||
      Object.keys(params.questions).length === 0
    ) {
      throw new Error(
        "Decision ask requires a non-empty 'questions' object.",
      );
    }

    return this.client.request<DecisionAskResult>(
      DECISION_ASK_METHOD,
      {
        state: params.state,
        questions: params.questions,
      },
    );
  }
}

export default DecisionApi;
