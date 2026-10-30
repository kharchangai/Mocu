import type {
  ExtractTypedFieldsParams,
  ExtractTypedFieldsResult,
} from "@mocu/extension-contracts";
import { EXTRACT_TYPED_FIELDS_METHOD } from "@mocu/extension-contracts";

import { JsonRpcProtocolClient } from "./protocol-client.js";

/** Extract, compute, estimate, or forecast typed values with Mocu's configured Extract model. */
export class TypedFieldsApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  async typedFields(
    params: ExtractTypedFieldsParams,
  ): Promise<ExtractTypedFieldsResult> {
    if (!params || params.state === undefined || params.state === null || (typeof params.state === "string" && !params.state.trim())) {
      throw new Error("Typed field extraction requires non-empty state.");
    }
    if (
      !params.fields ||
      typeof params.fields !== "object" ||
      Array.isArray(params.fields) ||
      Object.keys(params.fields).length === 0
    ) {
      throw new Error("Typed field extraction requires at least one field definition.");
    }

    return this.client.request<ExtractTypedFieldsResult>(
      EXTRACT_TYPED_FIELDS_METHOD,
      params,
    );
  }
}

export default TypedFieldsApi;
