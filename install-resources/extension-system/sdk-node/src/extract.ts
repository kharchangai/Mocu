import type {
  ExtractEntitiesParams,
  ExtractEntitiesResult,
} from "@mocu/extension-contracts";
import { EXTRACT_ENTITIES_METHOD } from "@mocu/extension-contracts";

import { JsonRpcProtocolClient } from "./protocol-client.js";

/** Extract named entities using Mocu's configured Extract model. */
export class ExtractApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  async entities(params: ExtractEntitiesParams): Promise<ExtractEntitiesResult> {
    if (!params || typeof params.text !== "string" || !params.text.trim()) {
      throw new Error("Extract entities requires a non-empty text string.");
    }
    if (!params.entities || typeof params.entities !== "object" || Array.isArray(params.entities) || !Object.keys(params.entities).length) {
      throw new Error("Extract entities requires at least one entity description.");
    }
    return this.client.request<ExtractEntitiesResult>(EXTRACT_ENTITIES_METHOD, {
      ...params,
      text: params.text.trim(),
    });
  }
}

export default ExtractApi;
