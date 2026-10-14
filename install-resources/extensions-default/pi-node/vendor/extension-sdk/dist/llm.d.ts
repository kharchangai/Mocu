import type { LlmGenerateParams, LlmGenerateResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/**
 * Lets an extension call the Mocu host LLM from inside a command.
 */
export declare class LlmApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    generate(params: LlmGenerateParams): Promise<LlmGenerateResult>;
}
export default LlmApi;
//# sourceMappingURL=llm.d.ts.map