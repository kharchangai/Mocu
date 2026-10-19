export const SUMMARIZE_TEXT_METHOD = "mocu.summarize.text" as const;

export interface SummarizeTextParams {
  text: string;
  instructions?: string;
}

export interface SummarizeTextResult {
  summary: string;
}
