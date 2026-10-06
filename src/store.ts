import { load, Store } from "@tauri-apps/plugin-store";
import {
  DOCS_RETRIEVAL_DEFAULTS,
  validateRangedInt,
  validateUnitInterval,
} from "./chat/docs/docs-retrieval-config";
export const OPENROUTER_GATEWAY_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_DECISION_BASE_URL = "https://openrouter.ai/api";
export const OPENROUTER_DECISION_DEFAULT_ENDPOINT = `${OPENROUTER_DECISION_BASE_URL}/alpha/decisions`;
export const OPENROUTER_DEFAULT_LLM_MODEL = "gpt-5.6-luna";
export const OPENROUTER_CHEAP_DEFAULT_MODEL = "openai/gpt-6-luna";
export const OPENROUTER_MEDIUM_DEFAULT_MODEL = "z-ai/glm-5.3-flash";
export const OPENROUTER_EXPENSIVE_DEFAULT_MODEL = "openai/gpt-6-luna";
export const OPENROUTER_STT_DEFAULT_MODEL = "openai/gpt-transcribe";
export const OPENROUTER_TTS_DEFAULT_MODEL = "x-ai/grok-voice-tts-1.0";
export const OPENROUTER_TTS_DEFAULT_VOICE = "ara";
export const OPENROUTER_VISION_DEFAULT_MODEL = "openai/gpt-6-luna";
export const OPENROUTER_EMBEDDING_DEFAULT_MODEL = "openai/text-embedding-3-large";
export const OPENROUTER_PERPLEXITY_DEFAULT_MODEL = "sonar";
export const OPENROUTER_DECISION_DEFAULT_MODEL = "~typesafe/jev-latest";

/** Decisions uses the gateway's API root, without the chat /v1 suffix. */
export function getDecisionEndpointForGateway(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base ? `${base.replace(/\/v1$/, "")}/alpha/decisions` : "";
}

function modelOrDefault(saved: string | null | undefined, fallback: string): string {
  return saved?.trim() || fallback;
}
export type AppSettings = {
  // LLM settings
  apiKey: string;
  gatewayBaseUrl: string;
  llmModel: string;

  cheapBaseUrl: string;
  cheapModel: string;

  mediumBaseUrl: string;
  mediumModel: string;

  expensiveBaseUrl: string;
  expensiveModel: string;

  // Speech settings
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;

  // Embedding settings
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  embeddingModel: string;

  // Vision settings
  visionApiKey: string;
  visionBaseUrl: string;
  visionModel: string;

  // Perplexity settings
  perplexityApiKey: string;
  perplexityBaseUrl: string;
  perplexityModel: string;
  searchDepth: number;

  // Docs retrieval settings (hybrid search: BM25 + keyword + embedding)
  docsBm25Weight: number;
  docsKeywordWeight: number;
  docsEmbeddingWeight: number;
  docsRelevanceThreshold: number;
  docsResultCap: number;
  docsCandidateDepth: number;
  // Docs Jev relevance refinement (bounded, one call per search)
  docsJevEnabled: boolean;
  docsJevCandidateLimit: number;
  docsJevTimeoutMs: number;
  docsJevWeight: number;
  // Decision (Jev) settings
  decisionApiKey: string;
  decisionEndpointUrl: string;
  decisionModel: string;
};

let settingsStore: Store | null = null;

export async function getSettingsStore(): Promise<Store> {
  if (!settingsStore) {
    settingsStore = await load("settings.json", {
      defaults: {},
      autoSave: false,
    });
  }

  return settingsStore;
}

async function reloadStore(store: Store): Promise<void> {
  const maybeReload = store as Store & {
    reload?: () => Promise<void>;
    load?: () => Promise<void>;
  };

  if (typeof maybeReload.reload === "function") {
    await maybeReload.reload();
    return;
  }

  if (typeof maybeReload.load === "function") {
    await maybeReload.load();
  }
}

function getValidSearchDepth(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }
  const depth = Math.floor(value);

  if (depth < 1) {
    return 1;
  }

  if (depth > 10) {
    return 10;
  }

  return depth;
}

function getValidBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export async function readSettings(): Promise<AppSettings> {
  const store = await getSettingsStore();
  await reloadStore(store);
  const rawDepth = await store.get<number>("MOCU_SEARCH_DEPTH");
  const legacyBaseUrl = ((await store.get<string>("MOCU_BASE_URL")) || "").trim();
  const savedCheapBaseUrl = ((await store.get<string>("MOCU_CHEAP_BASE_URL")) || "").trim();
  const savedMediumBaseUrl = ((await store.get<string>("MOCU_MEDIUM_BASE_URL")) || "").trim();
  const savedExpensiveBaseUrl = ((await store.get<string>("MOCU_EXPENSIVE_BASE_URL")) || "").trim();
  const savedVisionBaseUrl = ((await store.get<string>("MOCU_VISION_BASE_URL")) || "").trim();
  const savedEmbeddingBaseUrl = ((await store.get<string>("MOCU_EMBEDDING_BASE_URL")) || "").trim();
  const savedPerplexityBaseUrl = ((await store.get<string>("MOCU_PERPLEXITY_BASE_URL")) || "").trim();
  const gatewayBaseUrl = legacyBaseUrl || savedExpensiveBaseUrl || savedMediumBaseUrl || savedCheapBaseUrl || savedVisionBaseUrl || savedEmbeddingBaseUrl || savedPerplexityBaseUrl || OPENROUTER_GATEWAY_URL;
  const apiKey = ((await store.get<string>("MOCU_API_KEY")) || "").trim();
  const legacyLlmModel = ((await store.get<string>("MOCU_LLM_MODEL")) || "").trim();
  const savedDecisionEndpointUrl = await store.get<string>("MOCU_DECISION_ENDPOINT_URL");
  const savedDecisionBaseUrl = ((await store.get<string>("MOCU_DECISION_BASE_URL")) || "").trim();
  const decisionEndpointUrl = savedDecisionEndpointUrl?.trim() || (
    /\/alpha\/decisions\/?$/.test(savedDecisionBaseUrl)
      ? savedDecisionBaseUrl
      : getDecisionEndpointForGateway(savedDecisionBaseUrl || gatewayBaseUrl)
  );
  const savedCheapModel = await store.get<string>("MOCU_CHEAP_MODEL");
  const savedMediumModel = await store.get<string>("MOCU_MEDIUM_MODEL");
  const savedExpensiveModel = await store.get<string>("MOCU_EXPENSIVE_MODEL");
  return {
    apiKey, gatewayBaseUrl,
    llmModel: modelOrDefault(legacyLlmModel, OPENROUTER_DEFAULT_LLM_MODEL),
    cheapBaseUrl: legacyBaseUrl || savedCheapBaseUrl || gatewayBaseUrl,
    cheapModel: modelOrDefault(savedCheapModel, OPENROUTER_CHEAP_DEFAULT_MODEL),
    mediumBaseUrl: legacyBaseUrl || savedMediumBaseUrl || gatewayBaseUrl,
    mediumModel: modelOrDefault(savedMediumModel, OPENROUTER_MEDIUM_DEFAULT_MODEL),
    expensiveBaseUrl: legacyBaseUrl || savedExpensiveBaseUrl || gatewayBaseUrl,
    expensiveModel: modelOrDefault(savedExpensiveModel, OPENROUTER_EXPENSIVE_DEFAULT_MODEL),
    sttModel: modelOrDefault(await store.get<string>("MOCU_STT_MODEL"), OPENROUTER_STT_DEFAULT_MODEL),
    ttsModel: modelOrDefault(await store.get<string>("MOCU_TTS_MODEL"), OPENROUTER_TTS_DEFAULT_MODEL),
    ttsVoice: modelOrDefault(await store.get<string>("MOCU_TTS_VOICE"), OPENROUTER_TTS_DEFAULT_VOICE),
    embeddingApiKey: ((await store.get<string>("MOCU_EMBEDDING_API_KEY")) || "").trim() || apiKey,
    embeddingBaseUrl: legacyBaseUrl || savedEmbeddingBaseUrl || gatewayBaseUrl,
    embeddingModel: modelOrDefault(await store.get<string>("MOCU_EMBEDDING_MODEL"), OPENROUTER_EMBEDDING_DEFAULT_MODEL),
    visionApiKey: ((await store.get<string>("MOCU_VISION_API_KEY")) || "").trim() || apiKey,
    visionBaseUrl: legacyBaseUrl || savedVisionBaseUrl || gatewayBaseUrl,
    visionModel: modelOrDefault(await store.get<string>("MOCU_VISION_MODEL"), OPENROUTER_VISION_DEFAULT_MODEL),
    perplexityApiKey: ((await store.get<string>("MOCU_PERPLEXITY_API_KEY")) || "").trim() || apiKey,
    perplexityBaseUrl: legacyBaseUrl || savedPerplexityBaseUrl || gatewayBaseUrl,
    perplexityModel: modelOrDefault(await store.get<string>("MOCU_PERPLEXITY_MODEL"), OPENROUTER_PERPLEXITY_DEFAULT_MODEL),
    searchDepth: getValidSearchDepth(rawDepth),
    docsBm25Weight: validateUnitInterval(await store.get<number>("MOCU_DOCS_BM25_WEIGHT"), DOCS_RETRIEVAL_DEFAULTS.weights.bm25),
    docsKeywordWeight: validateUnitInterval(await store.get<number>("MOCU_DOCS_KEYWORD_WEIGHT"), DOCS_RETRIEVAL_DEFAULTS.weights.keyword),
    docsEmbeddingWeight: validateUnitInterval(await store.get<number>("MOCU_DOCS_EMBEDDING_WEIGHT"), DOCS_RETRIEVAL_DEFAULTS.weights.embedding),
    docsRelevanceThreshold: validateUnitInterval(await store.get<number>("MOCU_DOCS_RELEVANCE_THRESHOLD"), DOCS_RETRIEVAL_DEFAULTS.relevanceThreshold),
    docsResultCap: validateRangedInt(await store.get<number>("MOCU_DOCS_RESULT_CAP"), DOCS_RETRIEVAL_DEFAULTS.resultCap, 1, 50),
    docsCandidateDepth: validateRangedInt(await store.get<number>("MOCU_DOCS_CANDIDATE_DEPTH"), DOCS_RETRIEVAL_DEFAULTS.candidateDepth, 1, 200),
    docsJevEnabled: getValidBoolean(await store.get<boolean>("MOCU_DOCS_JEV_ENABLED"), DOCS_RETRIEVAL_DEFAULTS.jev.enabled),
    docsJevCandidateLimit: validateRangedInt(await store.get<number>("MOCU_DOCS_JEV_CANDIDATE_LIMIT"), DOCS_RETRIEVAL_DEFAULTS.jev.candidateLimit, 1, 20),
    docsJevTimeoutMs: validateRangedInt(await store.get<number>("MOCU_DOCS_JEV_TIMEOUT_MS"), DOCS_RETRIEVAL_DEFAULTS.jev.timeoutMs, 500, 30000),
    docsJevWeight: validateUnitInterval(await store.get<number>("MOCU_DOCS_JEV_WEIGHT"), DOCS_RETRIEVAL_DEFAULTS.jev.weight),
    decisionApiKey: ((await store.get<string>("MOCU_DECISION_API_KEY")) || "").trim(), decisionEndpointUrl,
    decisionModel: modelOrDefault(await store.get<string>("MOCU_DECISION_MODEL"), OPENROUTER_DECISION_DEFAULT_MODEL),
  };
}
export async function saveSettings(settings: AppSettings): Promise<void> {
  const store = await getSettingsStore();

  // LLM settings
  const sharedGatewayBaseUrl = settings.gatewayBaseUrl?.trim() || settings.expensiveBaseUrl?.trim() || OPENROUTER_GATEWAY_URL;
  await store.set("MOCU_API_KEY", (settings.apiKey || "").trim());
  await store.set("MOCU_BASE_URL", sharedGatewayBaseUrl);
  await store.set("MOCU_LLM_MODEL", modelOrDefault(settings.llmModel, OPENROUTER_DEFAULT_LLM_MODEL));

  await store.set(
    "MOCU_CHEAP_BASE_URL",
    sharedGatewayBaseUrl
  );
  await store.set(
    "MOCU_CHEAP_MODEL",
    modelOrDefault(settings.cheapModel, OPENROUTER_CHEAP_DEFAULT_MODEL),
  );

  await store.set(
    "MOCU_MEDIUM_BASE_URL",
    sharedGatewayBaseUrl
  );
  await store.set(
    "MOCU_MEDIUM_MODEL",
    modelOrDefault(settings.mediumModel, OPENROUTER_MEDIUM_DEFAULT_MODEL),
  );

  await store.set(
    "MOCU_EXPENSIVE_BASE_URL",
    sharedGatewayBaseUrl
  );
  await store.set(
    "MOCU_EXPENSIVE_MODEL",
    modelOrDefault(settings.expensiveModel, OPENROUTER_EXPENSIVE_DEFAULT_MODEL),
  );

  // Speech settings
  await store.set("MOCU_STT_MODEL", modelOrDefault(settings.sttModel, OPENROUTER_STT_DEFAULT_MODEL));
  await store.set("MOCU_TTS_MODEL", modelOrDefault(settings.ttsModel, OPENROUTER_TTS_DEFAULT_MODEL));
  await store.set("MOCU_TTS_VOICE", modelOrDefault(settings.ttsVoice, OPENROUTER_TTS_DEFAULT_VOICE));

  // Embedding settings
  await store.set(
    "MOCU_EMBEDDING_API_KEY",
    (settings.embeddingApiKey || "").trim(),
  );
  await store.set(
    "MOCU_EMBEDDING_BASE_URL",
    sharedGatewayBaseUrl
  );
  await store.set(
    "MOCU_EMBEDDING_MODEL",
    modelOrDefault(settings.embeddingModel, OPENROUTER_EMBEDDING_DEFAULT_MODEL),
  );

  // Vision settings
  await store.set(
    "MOCU_VISION_API_KEY",
    (settings.visionApiKey || "").trim(),
  );
  await store.set(
    "MOCU_VISION_BASE_URL",
    sharedGatewayBaseUrl
  );
  await store.set(
    "MOCU_VISION_MODEL",
    modelOrDefault(settings.visionModel, OPENROUTER_VISION_DEFAULT_MODEL),
  );

  // Perplexity settings
  await store.set(
    "MOCU_PERPLEXITY_API_KEY",
    (settings.perplexityApiKey || "").trim(),
  );
  await store.set(
    "MOCU_PERPLEXITY_BASE_URL",
    sharedGatewayBaseUrl
  );
  await store.set(
    "MOCU_PERPLEXITY_MODEL",
    modelOrDefault(settings.perplexityModel, OPENROUTER_PERPLEXITY_DEFAULT_MODEL),
  );

  // Decision (Jev) settings
  await store.set(
    "MOCU_DECISION_API_KEY",
    (settings.decisionApiKey || "").trim(),
  );
  const decisionEndpointUrl = settings.decisionEndpointUrl?.trim() || getDecisionEndpointForGateway(sharedGatewayBaseUrl);
  await store.set("MOCU_DECISION_ENDPOINT_URL", decisionEndpointUrl);
  await store.set("MOCU_DECISION_BASE_URL", decisionEndpointUrl.replace(/\/alpha\/decisions\/?$/, ""));
  await store.set(
    "MOCU_DECISION_MODEL",
    modelOrDefault(settings.decisionModel, OPENROUTER_DECISION_DEFAULT_MODEL),
  );
  await store.set(
    "MOCU_SEARCH_DEPTH",
    getValidSearchDepth(settings.searchDepth),
  );

  // Docs retrieval settings (validated exactly like readSettings)
  await store.set(
    "MOCU_DOCS_BM25_WEIGHT",
    validateUnitInterval(
      settings.docsBm25Weight,
      DOCS_RETRIEVAL_DEFAULTS.weights.bm25,
    ),
  );
  await store.set(
    "MOCU_DOCS_KEYWORD_WEIGHT",
    validateUnitInterval(
      settings.docsKeywordWeight,
      DOCS_RETRIEVAL_DEFAULTS.weights.keyword,
    ),
  );
  await store.set(
    "MOCU_DOCS_EMBEDDING_WEIGHT",
    validateUnitInterval(
      settings.docsEmbeddingWeight,
      DOCS_RETRIEVAL_DEFAULTS.weights.embedding,
    ),
  );
  await store.set(
    "MOCU_DOCS_RELEVANCE_THRESHOLD",
    validateUnitInterval(
      settings.docsRelevanceThreshold,
      DOCS_RETRIEVAL_DEFAULTS.relevanceThreshold,
    ),
  );
  await store.set(
    "MOCU_DOCS_RESULT_CAP",
    validateRangedInt(
      settings.docsResultCap,
      DOCS_RETRIEVAL_DEFAULTS.resultCap,
      1,
      50,
    ),
  );
  await store.set(
    "MOCU_DOCS_CANDIDATE_DEPTH",
    validateRangedInt(
      settings.docsCandidateDepth,
      DOCS_RETRIEVAL_DEFAULTS.candidateDepth,
      1,
      200,
    ),
  );
  await store.set(
    "MOCU_DOCS_JEV_ENABLED",
    typeof settings.docsJevEnabled === "boolean"
      ? settings.docsJevEnabled
      : DOCS_RETRIEVAL_DEFAULTS.jev.enabled,
  );
  await store.set(
    "MOCU_DOCS_JEV_CANDIDATE_LIMIT",
    validateRangedInt(
      settings.docsJevCandidateLimit,
      DOCS_RETRIEVAL_DEFAULTS.jev.candidateLimit,
      1,
      20,
    ),
  );
  await store.set(
    "MOCU_DOCS_JEV_TIMEOUT_MS",
    validateRangedInt(
      settings.docsJevTimeoutMs,
      DOCS_RETRIEVAL_DEFAULTS.jev.timeoutMs,
      500,
      30_000,
    ),
  );
  await store.set(
    "MOCU_DOCS_JEV_WEIGHT",
    validateUnitInterval(
      settings.docsJevWeight,
      DOCS_RETRIEVAL_DEFAULTS.jev.weight,
    ),
  );

  await store.save();
  await reloadStore(store);
}
