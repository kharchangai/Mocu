import { SUMMARIZE_TEXT_METHOD } from "@mocu/extension-contracts";
/** Summarizes text through Mocu's separately configured Summarize model. */
export class SummarizeApi {
    client;
    constructor(client) {
        this.client = client;
    }
    async text(params) {
        if (!params || typeof params.text !== "string" || !params.text.trim()) {
            throw new Error("Summarize text requires a non-empty text string.");
        }
        return this.client.request(SUMMARIZE_TEXT_METHOD, {
            ...params,
            text: params.text.trim(),
        });
    }
}
export default SummarizeApi;
//# sourceMappingURL=summarize.js.map