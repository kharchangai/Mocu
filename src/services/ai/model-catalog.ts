// src/services/ai/model-catalog.ts

import { readSettings } from "../../store";

export type GatewayModel = {
  id: string;

  name?: string;

  contextLength?: number;
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

type RawGatewayModel = {
  id?: unknown;

  name?: unknown;

  context_length?: unknown;

  context_window?: unknown;
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

    models.set(id, {
      id,

      ...(name ? { name } : {}),

      ...(contextLengthRaw && contextLengthRaw > 0
        ? { contextLength: contextLengthRaw }
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