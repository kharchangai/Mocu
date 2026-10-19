import type { SummarizeTextParams, SummarizeTextResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/** Summarizes text through Mocu's separately configured Summarize model. */
export declare class SummarizeApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    text(params: SummarizeTextParams): Promise<SummarizeTextResult>;
}
export default SummarizeApi;
//# sourceMappingURL=summarize.d.ts.map