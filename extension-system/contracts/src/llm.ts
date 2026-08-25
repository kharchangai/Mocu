export const LLM_GENERATE_METHOD = "mocu.llm.generate" as const;

export interface LlmGenerateParams {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmGenerateResult {
  text: string;
}
