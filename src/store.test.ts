import { beforeEach, describe, expect, it, vi } from "vitest";

const { values, mockStore } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    mockStore: {
      get: vi.fn(async (key: string) => values.get(key)),
      set: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }),
      save: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
    },
  };
});
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn(async () => mockStore) }));

import { getDecisionEndpointForGateway, readSettings, saveSettings } from "./store";

const expectedModels = {
  llmModel: "gpt-5.6-luna",
  cheapModel: "openai/gpt-6-luna",
  mediumModel: "z-ai/glm-5.3-flash",
  expensiveModel: "openai/gpt-6-luna",
  sttModel: "openai/gpt-transcribe",
  ttsModel: "x-ai/grok-voice-tts-1.0",
  ttsVoice: "ara",
  visionModel: "openai/gpt-6-luna",
  embeddingModel: "openai/text-embedding-3-large",
  perplexityModel: "sonar",
  decisionModel: "~typesafe/jev-latest",
  searchDepth: 3,
};
const urlFields = ["gatewayBaseUrl", "cheapBaseUrl", "mediumBaseUrl", "expensiveBaseUrl", "visionBaseUrl", "embeddingBaseUrl", "perplexityBaseUrl"] as const;

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
});

describe("gateway defaults", () => {
  it("prepopulates the exact requested models and URLs on first run, with no API key", async () => {
    const settings = await readSettings();
    expect(settings).toMatchObject(expectedModels);
    for (const field of urlFields) expect(settings[field]).toBe("https://openrouter.ai/api/v1");
    for (const field of ["apiKey", "embeddingApiKey", "visionApiKey", "perplexityApiKey", "decisionApiKey"] as const) {
      expect(settings[field]).toBe("");
    }
    expect(settings.decisionEndpointUrl).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  it("needs only the shared OpenRouter key and persists all defaults", async () => {
    const settings = await readSettings();
    await saveSettings({ ...settings, apiKey: " test-openrouter-key " });
    const loaded = await readSettings();
    expect(loaded).toMatchObject(expectedModels);
    expect(loaded.apiKey).toBe("test-openrouter-key");
    for (const field of ["embeddingApiKey", "visionApiKey", "perplexityApiKey"] as const) {
      expect(loaded[field]).toBe(loaded.apiKey);
    }
    expect(values.get("MOCU_DECISION_BASE_URL")).toBe("https://openrouter.ai/api");
    expect(mockStore.save).toHaveBeenCalledOnce();
  });

  it("keeps every default model for a custom gateway requiring only URL and key", async () => {
    values.set("MOCU_BASE_URL", "https://gateway.example/api/v1");
    values.set("MOCU_API_KEY", "custom-key");
    const settings = await readSettings();
    expect(settings).toMatchObject(expectedModels);
    for (const field of urlFields) expect(settings[field]).toBe("https://gateway.example/api/v1");
    expect(settings.decisionEndpointUrl).toBe("https://gateway.example/api/alpha/decisions");
    await saveSettings(settings);
    expect(await readSettings()).toMatchObject(settings);
    expect(values.get("MOCU_DECISION_BASE_URL")).toBe("https://gateway.example/api");
  });

  it("saves a gateway switch without resetting customized models", async () => {
    const settings = await readSettings();
    await saveSettings({ ...settings, apiKey: "new-key", gatewayBaseUrl: "https://other.example/v1", decisionEndpointUrl: "", cheapModel: "my-cheap-model", llmModel: "my-chat-model" });
    const loaded = await readSettings();
    expect(loaded).toMatchObject({ ...expectedModels, cheapModel: "my-cheap-model", llmModel: "my-chat-model" });
    for (const field of urlFields) expect(loaded[field]).toBe("https://other.example/v1");
    expect(loaded.decisionEndpointUrl).toBe("https://other.example/alpha/decisions");
  });

  it("preserves stored model selections, including an explicit openrouter/auto", async () => {
    values.set("MOCU_LLM_MODEL", "saved-chat");
    values.set("MOCU_CHEAP_MODEL", "openrouter/auto");
    values.set("MOCU_MEDIUM_MODEL", "saved-medium");
    values.set("MOCU_TTS_VOICE", "saved-voice");
    expect(await readSettings()).toMatchObject({ llmModel: "saved-chat", cheapModel: "openrouter/auto", mediumModel: "saved-medium", ttsVoice: "saved-voice" });
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  it("uses defaults for blank models on both read and save", async () => {
    values.set("MOCU_CHEAP_MODEL", "  ");
    values.set("MOCU_VISION_MODEL", "");
    const settings = await readSettings();
    expect(settings).toMatchObject(expectedModels);
    await saveSettings({ ...settings, cheapModel: " ", mediumModel: "", expensiveModel: "", sttModel: " ", ttsVoice: "" });
    expect(await readSettings()).toMatchObject(expectedModels);
    expect(values.get("MOCU_CHEAP_MODEL")).toBe(expectedModels.cheapModel);
  });

  it("retains legacy dedicated URLs and keys when loading existing settings", async () => {
    values.set("MOCU_API_KEY", "shared-key");
    values.set("MOCU_EXPENSIVE_BASE_URL", "https://chat.example/v1");
    values.set("MOCU_VISION_BASE_URL", "https://vision.example/v1");
    values.set("MOCU_VISION_API_KEY", "vision-key");
    values.set("MOCU_DECISION_BASE_URL", "https://decision.example/api");
    expect(await readSettings()).toMatchObject({ gatewayBaseUrl: "https://chat.example/v1", visionBaseUrl: "https://vision.example/v1", visionApiKey: "vision-key", decisionEndpointUrl: "https://decision.example/api/alpha/decisions" });
    expect(mockStore.set).not.toHaveBeenCalled();
  });

  it("preserves a customized Decision endpoint", async () => {
    values.set("MOCU_BASE_URL", "https://gateway.example/v1");
    values.set("MOCU_DECISION_ENDPOINT_URL", "https://decision.example/custom");
    expect((await readSettings()).decisionEndpointUrl).toBe("https://decision.example/custom");
  });

  it.each([
    ["https://openrouter.ai/api/v1/", "https://openrouter.ai/api/alpha/decisions"],
    ["https://other.example/v1", "https://other.example/alpha/decisions"],
    ["https://other.example/api", "https://other.example/api/alpha/decisions"],
    ["", ""],
  ])("derives the Decision endpoint from %s", (base, expected) => {
    expect(getDecisionEndpointForGateway(base)).toBe(expected);
  });
});
