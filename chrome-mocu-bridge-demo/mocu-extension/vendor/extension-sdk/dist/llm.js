import { LLM_GENERATE_METHOD } from "@mocu/extension-contracts";
/**
 * Lets an extension call the Mocu host LLM from inside a command.
 */
export class LlmApi {
    client;
    constructor(client) {
        this.client = client;
    }
    async generate(params) {
        if (!params ||
            typeof params.prompt !== "string" ||
            !params.prompt.trim()) {
            throw new Error("LLM generate requires a non-empty prompt string.");
        }
        return this.client.request(LLM_GENERATE_METHOD, {
            ...params,
            prompt: params.prompt.trim(),
        });
    }
}
export default LlmApi;
//# sourceMappingURL=llm.js.map