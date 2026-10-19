import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { readSettings } from "../../../store";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

/** Extracts named entities via OpenRouter's Scaledown Extract model. */
export const extractEntitiesTool = tool(
  async ({ text, entities, threshold, top_n }, config: RunnableConfig) => {
    const sourceText = text.trim();
    if (!sourceText) throw new Error("Provide non-empty text for entity extraction.");

    const settings = await readSettings();
    if (!settings.apiKey.trim()) {
      throw new Error("The shared OpenRouter API key is not configured in Settings.");
    }

    const baseUrl = settings.gatewayBaseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) throw new Error("The OpenRouter API base URL is not configured in Settings.");

    const model = settings.extractModel.trim();
    if (!model) throw new Error("The Extract LLM model is not configured in Settings.");

    const scaledown: Record<string, unknown> = { entities };
    if (threshold !== undefined) scaledown.threshold = threshold;
    if (top_n !== undefined) scaledown.top_n = top_n;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: sourceText }],
        provider: { options: { scaledown } },
      }),
      signal: config?.signal,
    });

    if (!response.ok) {
      throw new Error(`Extract API request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("The Extract LLM returned an empty or invalid response.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("The Extract LLM returned invalid JSON.");
    }
    if (
      !parsed || typeof parsed !== "object" ||
      !Array.isArray((parsed as { entities?: unknown }).entities)
    ) {
      throw new Error("The Extract LLM response must contain an entities array.");
    }
    return parsed;
  },
  {
    name: "extract_entities",
    description:
      "Extract named entities from supplied text using Mocu's configured Extract LLM. Define the entity names and descriptions; optionally set a minimum confidence threshold (0–1) and maximum number of entities.",
    schema: z.object({
      text: z.string().min(1).describe("The complete source text to inspect."),
      entities: z.record(z.string(), z.string()).refine((value) => Object.keys(value).length > 0, {
        message: "Define at least one entity to extract.",
      }).describe("Map each entity type/name to a short description of what to extract."),
      threshold: z.number().min(0).max(1).optional().describe("Optional minimum confidence from 0 to 1."),
      top_n: z.number().int().positive().optional().describe("Optional maximum number of entities to return."),
    }),
  },
);

export default extractEntitiesTool;
