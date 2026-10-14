export declare const LLM_GENERATE_METHOD: "mocu.llm.generate";
export interface LlmGenerateParams {
    prompt: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
}
export interface LlmGenerateResult {
    text: string;
}
//# sourceMappingURL=llm.d.ts.map