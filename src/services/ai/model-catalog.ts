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

  /** Whether the gateway explicitly advertises image input support. */
  supportsImages?: boolean;
};

/** Explicit gateway metadata wins; only known vision families are inferred. */
export const modelSupportsImageInput = (
  modelId: string,
  models: GatewayModel[] = [],
): boolean => {
  const advertised = models.find((model) => model.id === modelId)?.supportsImages;
  if (advertised !== undefined) return advertised;
  const id = modelId.toLowerCase().split('/').pop() ?? '';
  if (/(?:transcribe|tts|audio|realtime|image-generation)/.test(id)) return false;
  return /^(gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4\.5|gpt-5)(?:[-.]|$)/.test(id) ||
    /^gpt-4-(?:vision-preview|turbo(?:-2024-04-09)?)$/.test(id) ||
    /^(?:o1|o3|o4-mini)(?:-|$)/.test(id) && !/^o[13]-(?:mini|preview)(?:-|$)/.test(id) ||
    /^claude-(?:3|[\w]+-4|4)(?:[-.]|$)/.test(id) ||
    /^gemini-(?:1\.5|[2-9])(?:[-.]|$)/.test(id) ||
    /^(?:qwen.*-vl|llama.*-vision)(?:-|$)/.test(id);
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

  return config.llmModel.trim();
};

type RawGatewayModel = {
  id?: unknown;

  name?: unknown;

  context_length?: unknown;

  context_window?: unknown;

  supported_parameters?: unknown;

  architecture?: unknown;
  supports_images?: unknown;
  supports_vision?: unknown;
  capabilities?: unknown;

  reasoning?: unknown;
};

export const parseGatewayModels = (
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
    const architecture =
      rawModel.architecture && typeof rawModel.architecture === "object"
        ? (rawModel.architecture as { input_modalities?: unknown; modality?: unknown })
        : undefined;
    const inputModalities = Array.isArray(architecture?.input_modalities)
      ? architecture.input_modalities.filter((modality): modality is string => typeof modality === "string")
      : undefined;
    const modalityDescription = typeof architecture?.modality === "string"
      ? architecture.modality
      : "";
    const imageParameterAdvertised = supportedParameters.some((parameter) =>
      parameter === "image" || parameter === "image_url" || parameter === "vision",
    );
    const capabilities = rawModel.capabilities && typeof rawModel.capabilities === "object"
      ? rawModel.capabilities as { vision?: unknown }
      : undefined;
    const explicitSupport = [rawModel.supports_images, rawModel.supports_vision, capabilities?.vision]
      .find((value) => typeof value === "boolean");
    const supportsImages = typeof explicitSupport === "boolean"
      ? explicitSupport
      : inputModalities
        ? inputModalities.some((modality) => modality.toLowerCase() === "image")
        : modalityDescription
          ? /image/i.test(modalityDescription.split("->")[0])
          : imageParameterAdvertised;
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

      ...(typeof explicitSupport === "boolean" || inputModalities || modalityDescription || imageParameterAdvertised
        ? { supportsImages }
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
        { headers, signal: AbortSignal.timeout(10_000) },
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
