import { EXTRACT_ENTITIES_METHOD } from "@mocu/extension-contracts";
/** Extract named entities using Mocu's configured Extract model. */
export class ExtractApi {
    client;
    constructor(client) {
        this.client = client;
    }
    async entities(params) {
        if (!params || typeof params.text !== "string" || !params.text.trim()) {
            throw new Error("Extract entities requires a non-empty text string.");
        }
        if (!params.entities || typeof params.entities !== "object" || Array.isArray(params.entities) || !Object.keys(params.entities).length) {
            throw new Error("Extract entities requires at least one entity description.");
        }
        return this.client.request(EXTRACT_ENTITIES_METHOD, {
            ...params,
            text: params.text.trim(),
        });
    }
}
export default ExtractApi;
//# sourceMappingURL=extract.js.map