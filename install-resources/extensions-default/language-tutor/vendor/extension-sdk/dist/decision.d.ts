import type { DecisionAskParams, DecisionAskResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/**
 * Lets an extension ask typed probabilistic questions through Mocu's
 * configured Jev decision model (OpenRouter Decisions API).
 */
export declare class DecisionApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    ask(params: DecisionAskParams): Promise<DecisionAskResult>;
}
export default DecisionApi;
//# sourceMappingURL=decision.d.ts.map