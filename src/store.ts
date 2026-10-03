import { load, Store } from "@tauri-apps/plugin-store";
import {
  DOCS_RETRIEVAL_DEFAULTS,
  validateRangedInt,
  validateUnitInterval,
} from "./chat/docs/docs-retrieval-config";
export type AppSettings = {
  // LLM settings
  apiKey: string;

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
  decisionBaseUrl: string;
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

  const legacyBaseUrl = (
    (await store.get<string>("MOCU_BASE_URL")) || ""
  ).trim();

  const legacyLlmModel = (
    (await store.get<string>("MOCU_LLM_MODEL")) || ""
  ).trim();

  const expensiveBaseUrl = (
    (await store.get<string>("MOCU_EXPENSIVE_BASE_URL")) || legacyBaseUrl
  ).trim();

  const expensiveModel = (
    (await store.get<string>("MOCU_EXPENSIVE_MODEL")) || legacyLlmModel
  ).trim();

  return {
    // LLM settings
    apiKey: ((await store.get<string>("MOCU_API_KEY")) || "").trim(),

    cheapBaseUrl: (
      (await store.get<string>("MOCU_CHEAP_BASE_URL")) || ""
    ).trim(),
    cheapModel: ((await store.get<string>("MOCU_CHEAP_MODEL")) || "").trim(),

    mediumBaseUrl: (
      (await store.get<string>("MOCU_MEDIUM_BASE_URL")) || ""
    ).trim(),
    mediumModel: (
      (await store.get<string>("MOCU_MEDIUM_MODEL")) || ""
    ).trim(),

    // Falls back to old settings for migration compatibility.
    expensiveBaseUrl,
    expensiveModel,

    // Speech settings
    sttModel: ((await store.get<string>("MOCU_STT_MODEL")) || "").trim(),
    ttsModel: ((await store.get<string>("MOCU_TTS_MODEL")) || "").trim(),
    ttsVoice: ((await store.get<string>("MOCU_TTS_VOICE")) || "").trim(),

    // Embedding settings
    embeddingApiKey: (
      (await store.get<string>("MOCU_EMBEDDING_API_KEY")) || ""
    ).trim(),
    embeddingBaseUrl: (
      (await store.get<string>("MOCU_EMBEDDING_BASE_URL")) || ""
    ).trim(),
    embeddingModel: (
      (await store.get<string>("MOCU_EMBEDDING_MODEL")) || ""
    ).trim(),

    // Vision settings
    visionApiKey: (
      (await store.get<string>("MOCU_VISION_API_KEY")) || ""
    ).trim(),
    visionBaseUrl: (
      (await store.get<string>("MOCU_VISION_BASE_URL")) || ""
    ).trim(),
    visionModel: (
      (await store.get<string>("MOCU_VISION_MODEL")) || ""
    ).trim(),

    // Perplexity settings
    perplexityApiKey: (
      (await store.get<string>("MOCU_PERPLEXITY_API_KEY")) || ""
    ).trim(),
    perplexityBaseUrl: (
      (await store.get<string>("MOCU_PERPLEXITY_BASE_URL")) ||
      "https://api.perplexity.ai"
    ).trim(),
    perplexityModel: (
      (await store.get<string>("MOCU_PERPLEXITY_MODEL")) || "sonar"
    ).trim(),
    searchDepth: getValidSearchDepth(rawDepth),

    // Docs retrieval settings (validated: [0,1] weights/threshold,
    // ranged integer caps — see docs-retrieval-config.ts)
    docsBm25Weight: validateUnitInterval(
      await store.get<number>("MOCU_DOCS_BM25_WEIGHT"),
      DOCS_RETRIEVAL_DEFAULTS.weights.bm25,
    ),
    docsKeywordWeight: validateUnitInterval(
      await store.get<number>("MOCU_DOCS_KEYWORD_WEIGHT"),
      DOCS_RETRIEVAL_DEFAULTS.weights.keyword,
    ),
    docsEmbeddingWeight: validateUnitInterval(
      await store.get<number>("MOCU_DOCS_EMBEDDING_WEIGHT"),
      DOCS_RETRIEVAL_DEFAULTS.weights.embedding,
    ),
    docsRelevanceThreshold: validateUnitInterval(
      await store.get<number>("MOCU_DOCS_RELEVANCE_THRESHOLD"),
      DOCS_RETRIEVAL_DEFAULTS.relevanceThreshold,
    ),
    docsResultCap: validateRangedInt(
      await store.get<number>("MOCU_DOCS_RESULT_CAP"),
      DOCS_RETRIEVAL_DEFAULTS.resultCap,
      1,
      50,
    ),
    docsCandidateDepth: validateRangedInt(
      await store.get<number>("MOCU_DOCS_CANDIDATE_DEPTH"),
      DOCS_RETRIEVAL_DEFAULTS.candidateDepth,
      1,
      200,
    ),
    docsJevEnabled: getValidBoolean(
      await store.get<boolean>("MOCU_DOCS_JEV_ENABLED"),
      DOCS_RETRIEVAL_DEFAULTS.jev.enabled,
    ),
    docsJevCandidateLimit: validateRangedInt(
      await store.get<number>("MOCU_DOCS_JEV_CANDIDATE_LIMIT"),
      DOCS_RETRIEVAL_DEFAULTS.jev.candidateLimit,
      1,
      20,
    ),
    docsJevTimeoutMs: validateRangedInt(
      await store.get<number>("MOCU_DOCS_JEV_TIMEOUT_MS"),
      DOCS_RETRIEVAL_DEFAULTS.jev.timeoutMs,
      500,
      30_000,
    ),
    docsJevWeight: validateUnitInterval(
      await store.get<number>("MOCU_DOCS_JEV_WEIGHT"),
      DOCS_RETRIEVAL_DEFAULTS.jev.weight,
    ),

    // Decision (Jev) settings
    decisionApiKey: (
      (await store.get<string>("MOCU_DECISION_API_KEY")) || ""
    ).trim(),
    decisionBaseUrl: (
      (await store.get<string>("MOCU_DECISION_BASE_URL")) ||
      "https://openrouter.ai/api"
    ).trim(),
    decisionModel: (
      (await store.get<string>("MOCU_DECISION_MODEL")) ||
      "~typesafe/jev-latest"
    ).trim(),
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const store = await getSettingsStore();

  // LLM settings
  await store.set("MOCU_API_KEY", (settings.apiKey || "").trim());

  await store.set(
    "MOCU_CHEAP_BASE_URL",
    (settings.cheapBaseUrl || "").trim(),
  );
  await store.set(
    "MOCU_CHEAP_MODEL",
    (settings.cheapModel || "").trim(),
  );

  await store.set(
    "MOCU_MEDIUM_BASE_URL",
    (settings.mediumBaseUrl || "").trim(),
  );
  await store.set(
    "MOCU_MEDIUM_MODEL",
    (settings.mediumModel || "").trim(),
  );

  await store.set(
    "MOCU_EXPENSIVE_BASE_URL",
    (settings.expensiveBaseUrl || "").trim(),
  );
  await store.set(
    "MOCU_EXPENSIVE_MODEL",
    (settings.expensiveModel || "").trim(),
  );

  // Speech settings
  await store.set("MOCU_STT_MODEL", (settings.sttModel || "").trim());
  await store.set("MOCU_TTS_MODEL", (settings.ttsModel || "").trim());
  await store.set("MOCU_TTS_VOICE", (settings.ttsVoice || "").trim());

  // Embedding settings
  await store.set(
    "MOCU_EMBEDDING_API_KEY",
    (settings.embeddingApiKey || "").trim(),
  );
  await store.set(
    "MOCU_EMBEDDING_BASE_URL",
    (settings.embeddingBaseUrl || "").trim(),
  );
  await store.set(
    "MOCU_EMBEDDING_MODEL",
    (settings.embeddingModel || "").trim(),
  );

  // Vision settings
  await store.set(
    "MOCU_VISION_API_KEY",
    (settings.visionApiKey || "").trim(),
  );
  await store.set(
    "MOCU_VISION_BASE_URL",
    (settings.visionBaseUrl || "").trim(),
  );
  await store.set(
    "MOCU_VISION_MODEL",
    (settings.visionModel || "").trim(),
  );

  // Perplexity settings
  await store.set(
    "MOCU_PERPLEXITY_API_KEY",
    (settings.perplexityApiKey || "").trim(),
  );
  await store.set(
    "MOCU_PERPLEXITY_BASE_URL",
    (
      settings.perplexityBaseUrl || "https://api.perplexity.ai"
    ).trim(),
  );
  await store.set(
    "MOCU_PERPLEXITY_MODEL",
    (settings.perplexityModel || "sonar").trim(),
  );

  // Decision (Jev) settings
  await store.set(
    "MOCU_DECISION_API_KEY",
    (settings.decisionApiKey || "").trim(),
  );
  await store.set(
    "MOCU_DECISION_BASE_URL",
    (
      settings.decisionBaseUrl || "https://openrouter.ai/api"
    ).trim(),
  );
  await store.set(
    "MOCU_DECISION_MODEL",
    (settings.decisionModel || "~typesafe/jev-latest").trim(),
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