// Regression tests for the embedding input limit handling: long turns
// (especially non-ASCII text like Persian, which packs far fewer
// characters per token than English) used to exceed the provider's
// 8192-token input cap and fail the whole project memory save.

import { describe, expect, it } from "vitest";

import {
  isEmbeddingInputTooLongError,
  shrinkEmbeddingText,
  truncateEmbeddingText,
} from "./textSimilarity";

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
