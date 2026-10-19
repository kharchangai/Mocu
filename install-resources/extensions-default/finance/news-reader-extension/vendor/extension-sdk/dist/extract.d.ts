import type { ExtractEntitiesParams, ExtractEntitiesResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/** Extract named entities using Mocu's configured Extract model. */
export declare class ExtractApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    entities(params: ExtractEntitiesParams): Promise<ExtractEntitiesResult>;
}
export default ExtractApi;
//# sourceMappingURL=extract.d.ts.map