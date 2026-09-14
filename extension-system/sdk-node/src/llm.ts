import type {
  LlmGenerateParams,
  LlmGenerateResult,
} from "@mocu/extension-contracts";

import { LLM_GENERATE_METHOD } from "@mocu/extension-contracts";

import { JsonRpcProtocolClient } from "./protocol-client.js";

/**
 * Lets an extension call the Mocu host LLM from inside a command.
 */
export class LlmApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  async generate(
    params: LlmGenerateParams,
  ): Promise<LlmGenerateResult> {
    if (
      !params ||
      typeof params.prompt !== "string" ||
      !params.prompt.trim()
    ) {
      throw new Error(
        "LLM generate requires a non-empty prompt string.",
      );
    }

    return this.client.request<LlmGenerateResult>(
      LLM_GENERATE_METHOD,
      {
        ...params,
        prompt: params.prompt.trim(),
      },
    );
  }
}

export default LlmApi;