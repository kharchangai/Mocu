// src/services/ai/model-catalog.ts

import { readSettings } from "../../store";

export type GatewayReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type GatewayModel = {
  id: string;

  name?: string;

  contextLength?: number;

  /** Effort levels advertised by the gateway for this model. */
  supportedReasoningEfforts?: GatewayReasoningEffort[];
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/*
 * Picks the shared gateway base URL used by the main agents. The
 * expensive tier is the main chat tier, so it is preferred; the other
 * tiers keep this working when only one of them is configured.
 */
export const getMainGatewayBaseUrl = (
  config: Awaited<ReturnType<typeof readSettings>>,
): string => {
  return (
    config.expensiveBaseUrl ||
    config.mediumBaseUrl ||
    config.cheapBaseUrl ||
    ""
  ).trim();
};

/** The configured model used by the main chat and project agents by default. */
export const getMainAgentDefaultModel = async (): Promise<string> => {
  const config = await readSettings();

  return config.expensiveModel.trim();
};

type RawGatewayModel = {
  id?: unknown;

  name?: unknown;

  context_length?: unknown;

  context_window?: unknown;

  supported_parameters?: unknown;

  reasoning?: unknown;
};

const parseGatewayModels = (
  payload: unknown,
): GatewayModel[] => {
  const data =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown }).data)
      ? ((payload as { data: unknown[] }).data)
      : Array.isArray(payload)
        ? payload
        : [];

  const models = new Map<string, GatewayModel>();

  for (const entry of data) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const rawModel = entry as RawGatewayModel;

    const id =
      typeof rawModel.id === "string"
        ? rawModel.id.trim()
        : "";

    if (!id) {
      continue;
    }

    if (models.has(id)) {
      continue;
    }

    const name =
      typeof rawModel.name === "string" &&
      rawModel.name.trim() &&
      rawModel.name.trim() !== id
        ? rawModel.name.trim()
        : undefined;

    const contextLengthRaw =
      typeof rawModel.context_length === "number"
        ? rawModel.context_length
        : typeof rawModel.context_window === "number"
          ? rawModel.context_window
          : undefined;

    const supportedParameters = Array.isArray(rawModel.supported_parameters)
      ? rawModel.supported_parameters.filter(
          (parameter): parameter is string => typeof parameter === "string",
        )
      : [];
    const reasoningMetadata =
      rawModel.reasoning && typeof rawModel.reasoning === "object"
        ? (rawModel.reasoning as { supported_efforts?: unknown })
        : undefined;
    const advertisedEfforts = Array.isArray(reasoningMetadata?.supported_efforts)
      ? reasoningMetadata.supported_efforts.filter(
          (effort): effort is GatewayReasoningEffort =>
            effort === "minimal" ||
            effort === "low" ||
            effort === "medium" ||
            effort === "high" ||
            effort === "xhigh",
        )
      : [];
    const supportsReasoning =
      supportedParameters.includes("reasoning") ||
      supportedParameters.includes("reasoning_effort") ||
      advertisedEfforts.length > 0;
    const supportedReasoningEfforts = supportsReasoning
      ? advertisedEfforts.length > 0
        ? advertisedEfforts
        : (["low", "medium", "high"] as GatewayReasoningEffort[])
      : undefined;

    models.set(id, {
      id,

      ...(name ? { name } : {}),

      ...(contextLengthRaw && contextLengthRaw > 0
        ? { contextLength: contextLengthRaw }
        : {}),

      ...(supportedReasoningEfforts
        ? { supportedReasoningEfforts }
        : {}),
    });
  }

  return [...models.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
};

/*
 * Fetches the model list from the configured AI gateway.
 *
 * Almost every OpenAI-compatible gateway (OpenRouter, OpenAI, Groq,
 * Together, LM Studio, Ollama's OpenAI endpoint, ...) exposes the same
 * `GET {baseUrl}/models` endpoint, so one request works for all of them.
 */
export const listGatewayModels =
  async (): Promise<GatewayModel[]> => {
    const config =
      await readSettings();

    const baseUrl =
      getMainGatewayBaseUrl(config);

    if (!baseUrl) {
      throw new Error(
        "The gateway base URL is not configured. Open Settings and set a base URL first.",
      );
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (config.apiKey.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    let response: Response;

    try {
      response = await fetch(
        `${normalizeBaseUrl(baseUrl)}/models`,
        { headers },
      );
    } catch (error: unknown) {
      throw new Error(
        `Could not reach the gateway model list: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `The gateway model list request failed with status ${response.status}.`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error: unknown) {
      throw new Error(
        `The gateway returned an invalid model list: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const models =
      parseGatewayModels(payload);

    if (models.length === 0) {
      throw new Error(
        "The gateway did not return any usable models.",
      );
    }

    return models;
  };