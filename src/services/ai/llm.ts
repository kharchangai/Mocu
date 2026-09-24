import { ChatOpenAI } from "@langchain/openai";
import { readSettings } from "../../store";
import {
  getMainGatewayBaseUrl,
  type GatewayReasoningEffort,
} from "./model-catalog";

export type LlmTier = "cheap" | "medium" | "expensive";

type LlmTierConfig = {
  baseUrl: string;
  model: string;
};

export type LlmGenerationOptions = {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: GatewayReasoningEffort | null;
};

function normalizeBaseUrl(baseUrl: string): string | undefined {
  const normalized = baseUrl.trim().replace(/\/+$/, "");

  return normalized || undefined;
}

function getTierConfig(
  tier: LlmTier,
  config: Awaited<ReturnType<typeof readSettings>>,
): LlmTierConfig {
  switch (tier) {
    case "cheap":
      return {
        baseUrl: config.cheapBaseUrl || "",
        model: config.cheapModel || "",
      };

    case "medium":
      return {
        baseUrl: config.mediumBaseUrl || "",
        model: config.mediumModel || "",
      };

    case "expensive":
      return {
        baseUrl: config.expensiveBaseUrl || "",
        model: config.expensiveModel || "",
      };
  }
}

export const getAsyncLLM = async (
  tier: LlmTier = "medium",
  options: LlmGenerationOptions = {},
): Promise<ChatOpenAI> => {
  const config = await readSettings();

  const apiKey = config.apiKey || "";
  const selectedModel = getTierConfig(tier, config);

  if (!selectedModel.model.trim()) {
    throw new Error(
      `The ${tier} LLM model is not configured. Open Settings and set its model name.`,
    );
  }

  if (!selectedModel.baseUrl.trim()) {
    throw new Error(
      `The ${tier} LLM base URL is not configured. Open Settings and set its base URL.`,
    );
  }

  return new ChatOpenAI({
    apiKey,
    model: selectedModel.model.trim(),
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.maxTokens === undefined
      ? {}
      : { maxTokens: options.maxTokens }),
    ...(options.reasoningEffort
      ? {
          modelKwargs: {
            reasoning: { effort: options.reasoningEffort },
          },
        }
      : {}),
    configuration: {
      baseURL: normalizeBaseUrl(selectedModel.baseUrl),
    },
  });
};

export const getAsyncLLMByModel = async (
  model: string,
  options: LlmGenerationOptions = {},
): Promise<ChatOpenAI> => {
  const config = await readSettings();

  const trimmedModel = model.trim();

  if (!trimmedModel) {
    throw new Error(
      "The LLM model name is not set. Pass a model name like 'gpt-4'.",
    );
  }

  // A model name is not tied to a tier. Use the shared LLM endpoint for
  // every model instead of selecting a different URL based on its name.
  // `mediumBaseUrl` is the canonical shared URL; the fallbacks keep this
  // working when only one of the tier fields has been configured.
  const baseUrl =
    config.mediumBaseUrl || config.cheapBaseUrl || config.expensiveBaseUrl;

  if (!baseUrl.trim()) {
    throw new Error(
      "The LLM base URL is not configured. Open Settings and set its base URL.",
    );
  }

  return new ChatOpenAI({
    apiKey: config.apiKey || "",
    model: trimmedModel,
    ...(options.temperature === undefined
      ? {}
      : { temperature: options.temperature }),
    ...(options.maxTokens === undefined
      ? {}
      : { maxTokens: options.maxTokens }),
    configuration: {
      baseURL: normalizeBaseUrl(baseUrl),
    },
  });
};

/*
 * Builds the LLM for the two main agents (chat agent and project agent)
 * honoring a per-request model override chosen in the chat composer.
 *
 * When an override is set it is used for every LLM call inside those two
 * agents. When no override is set the same tier that was used before the
 * model picker existed is used (fallbackTier), so nothing changes for
 * memory, tools, child agents, or any other service.
 */
export const getMainAgentLlm = async (
  selectedModel: string,
  options: LlmGenerationOptions = {},
  fallbackTier: LlmTier = "expensive",
): Promise<ChatOpenAI> => {
  const trimmedModel = selectedModel.trim();

  if (trimmedModel) {
    const config = await readSettings();

    const baseUrl = getMainGatewayBaseUrl(config);

    if (!baseUrl.trim()) {
      throw new Error(
        "The LLM base URL is not configured. Open Settings and set its base URL.",
      );
    }

    return new ChatOpenAI({
      apiKey: config.apiKey || "",
      model: trimmedModel,
      ...(options.temperature === undefined
        ? {}
        : { temperature: options.temperature }),
      ...(options.maxTokens === undefined
        ? {}
        : { maxTokens: options.maxTokens }),
      ...(options.reasoningEffort
        ? {
            modelKwargs: {
              reasoning: { effort: options.reasoningEffort },
            },
          }
        : {}),
      configuration: {
        baseURL: normalizeBaseUrl(baseUrl),
      },
    });
  }

  return getAsyncLLM(fallbackTier, options);
};

/*
 * Reads the per-request model override from the agent RunnableConfig.
 * It is set by the chat composer and only consumed by the main agents;
 * every other agent keeps using its own configured model.
 */
export const getSelectedChatModel = (
  config?: { configurable?: Record<string, unknown> },
): string => {
  const value = config?.configurable?.selectedModel;

  return typeof value === "string" ? value.trim() : "";
};

export const getSelectedChatReasoningEffort = (
  config?: { configurable?: Record<string, unknown> },
): GatewayReasoningEffort | null => {
  const value = config?.configurable?.reasoningEffort;

  return value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : null;
};

export { getMainGatewayBaseUrl };