// Regression tests for the embedding input limit handling: long turns
// (especially non-ASCII text like Persian, which packs far fewer
// characters per token than English) used to exceed the provider's
// 8192-token input cap and fail the whole project memory save.

import { afterEach, describe, expect, it, vi } from "vitest";

const { readSettingsMock } = vi.hoisted(() => ({
  readSettingsMock: vi.fn(),
}));
vi.mock("../../../store", () => ({ readSettings: readSettingsMock }));

import {
  isEmbeddingInputTooLongError,
  shrinkEmbeddingText,
  TextSimilarity,
  truncateEmbeddingText,
} from "./textSimilarity";

const testSettings = {
  embeddingModel: "amazon/titan-embed-text-v1",
  embeddingBaseUrl: "https://openrouter.ai/api/v1/",
  embeddingApiKey: "embedding-key",
  apiKey: "shared-key",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("truncateEmbeddingText", () => {
  it("keeps short text unchanged", () => {
    const text = "Short English text.";
    expect(truncateEmbeddingText(text)).toBe(text);
  });

  it("caps long English text", () => {
    const text = "word ".repeat(20000);
    const truncated = truncateEmbeddingText(text);

    expect(truncated.length).toBeLessThan(text.length);
    // ASCII ≈ 4 chars/token → 6000 tokens ≈ 24000 chars.
    expect(truncated.length).toBeLessThanOrEqual(24000);
  });

  it("caps long Persian text far below the old 24000-char cut", () => {
    const text = "متن فارسی برای آزمایش حافظه پروژه. ".repeat(2000);
    const truncated = truncateEmbeddingText(text);

    expect(truncated.length).toBeLessThan(text.length);
    // Budget: 6000 tokens at ≈ 0.6 tokens/non-ASCII unit ≈ 11k chars.
    expect(truncated.length).toBeGreaterThanOrEqual(10000);
    expect(truncated.length).toBeLessThanOrEqual(12000);
  });

  it("never splits a surrogate pair", () => {
    const text = "😀".repeat(20000);
    const truncated = truncateEmbeddingText(text);

    // Every remaining code unit must be a complete emoji.
    expect(truncated.length % 2).toBe(0);
  });
});

describe("shrinkEmbeddingText", () => {
  it("halves the text", () => {
    expect(shrinkEmbeddingText("abcdefgh")).toBe("abcd");
  });

  it("does not leave a dangling surrogate", () => {
    // "😀a" is 3 UTF-16 units; the half point lands inside the emoji,
    // so the shrink must drop the split pair entirely.
    expect(shrinkEmbeddingText("\ud83d")).toBe("");
    expect(shrinkEmbeddingText("😀a")).toBe("");
    expect(shrinkEmbeddingText("😀😀")).toBe("😀");
  });
});

describe("isEmbeddingInputTooLongError", () => {
  it("recognizes provider length errors", () => {
    expect(
      isEmbeddingInputTooLongError(
        new Error(
          '400 HTTP 400: {"error":{"message":"Invalid \'input[0]\': maximum input length is 8192 tokens."}}',
        ),
      ),
    ).toBe(true);

    expect(
      isEmbeddingInputTooLongError(
        new Error("This model's maximum context length is 8192 tokens."),
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(
      isEmbeddingInputTooLongError(new Error("Invalid API key")),
    ).toBe(false);

    expect(
      isEmbeddingInputTooLongError(
        new Error("Embedding provider returned 2 vectors for 3 texts."),
      ),
    ).toBe(false);
  });
});


describe("provider-agnostic embedding requests", () => {
  it("sends the standard OpenRouter embeddings payload and accepts Titan vectors", async () => {
    readSettingsMock.mockResolvedValue(testSettings);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({
        data: [
          { object: "embedding", embedding: [0.3, 0.4], index: 1 },
          { object: "embedding", embedding: [0.1, 0.2], index: 0 },
        ],
        model: testSettings.embeddingModel,
      }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const vectors = await new TextSimilarity().embedTexts(["first", "second"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(init?.headers).toEqual({
      Authorization: "Bearer embedding-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "amazon/titan-embed-text-v1",
      input: ["first", "second"],
      encoding_format: "float",
    });
    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("accepts a full embeddings endpoint and a provider response using embeddings", async () => {
    readSettingsMock.mockResolvedValue({
      ...testSettings,
      embeddingBaseUrl: "https://provider.example/v1/embeddings",
    });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ embeddings: [[1, 2, 3]] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(new TextSimilarity().embedText("hello")).resolves.toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://provider.example/v1/embeddings");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ input: "hello" });
  });

  it("reports provider HTTP errors including the response detail", async () => {
    readSettingsMock.mockResolvedValue(testSettings);
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "Unsupported embedding model" } }), { status: 400 }),
    ));

    await expect(new TextSimilarity().embedText("hello")).rejects.toThrow(
      /400.*Unsupported embedding model/,
    );
  });
});
