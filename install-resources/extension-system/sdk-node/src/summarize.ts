import type {
  SummarizeTextParams,
  SummarizeTextResult,
} from "@mocu/extension-contracts";
import { SUMMARIZE_TEXT_METHOD } from "@mocu/extension-contracts";

import { JsonRpcProtocolClient } from "./protocol-client.js";

/** Summarizes text through Mocu's separately configured Summarize model. */
export class SummarizeApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  async text(params: SummarizeTextParams): Promise<SummarizeTextResult> {
    if (!params || typeof params.text !== "string" || !params.text.trim()) {
      throw new Error("Summarize text requires a non-empty text string.");
    }

    return this.client.request<SummarizeTextResult>(SUMMARIZE_TEXT_METHOD, {
      ...params,
      text: params.text.trim(),
    });
  }
}

export default SummarizeApi;
