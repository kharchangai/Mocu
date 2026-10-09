import type { EmbeddingEmbedParams, EmbeddingEmbedResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/**
 * Lets an extension create embedding vectors with Mocu's configured
 * embedding model (whatever provider/API key the user set up in Mocu).
 */
export declare class EmbeddingApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    embed(params: EmbeddingEmbedParams): Promise<EmbeddingEmbedResult>;
    /**
     * Convenience wrapper: embed a single text and return its vector.
     */
    embedText(text: string): Promise<number[]>;
}
export default EmbeddingApi;
//# sourceMappingURL=embedding.d.ts.map