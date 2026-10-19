import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { readSettings } from "../../../store";

const DEFAULT_SUMMARIZATION_INSTRUCTIONS =
  "Summarize the supplied text faithfully. Preserve important facts, decisions, names, dates, numbers, and caveats. Do not add information that is not present in the source.";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

/** Summarizes plain text through the separately configured Summarize LLM. */
export const summarizeTextTool = tool(
  async ({ text, instructions }, config: RunnableConfig) => {
    const sourceText = text.trim();
    if (!sourceText) {
      throw new Error("Provide non-empty text to summarize.");
    }

    const settings = await readSettings();
    if (!settings.apiKey.trim()) {
      throw new Error("The shared OpenRouter API key is not configured in Settings.");
    }

    const baseUrl = settings.gatewayBaseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("The OpenRouter API base URL is not configured in Settings.");
    }

    const model = settings.summarizeModel.trim();
    if (!model) {
      throw new Error("The Summarize LLM model is not configured in Settings.");
    }

    const customInstructions = instructions?.trim();
    const systemMessage = customInstructions
      ? `${DEFAULT_SUMMARIZATION_INSTRUCTIONS}\n\nAdditional summary requirements from the agent: ${customInstructions}`
      : DEFAULT_SUMMARIZATION_INSTRUCTIONS;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: sourceText },
        ],
      }),
      signal: config?.signal,
    });

    if (!response.ok) {
      throw new Error(`Summarize API request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const summary = data.choices?.[0]?.message?.content;
    if (typeof summary !== "string" || !summary.trim()) {
      throw new Error("The Summarize LLM returned an empty or invalid response.");
    }

    return summary.trim();
  },
  {
    name: "summarize_text",
    description:
      "Summarize user-provided text using Mocu's separately configured Summarize LLM. Optionally specify the desired format or length; the result is plain text.",
    schema: z.object({
      text: z.string().min(1).describe("The complete source text to summarize."),
      instructions: z
        .string()
        .optional()
        .describe("Optional requirements such as length, language, format, or details to preserve."),
    }),
  },
);
