import { describe, expect, it } from "vitest";

import { splitIntoSpeechChunks } from "./text_to_speech_tool";

describe("splitIntoSpeechChunks", () => {
  it("returns empty array for empty text", () => {
    expect(splitIntoSpeechChunks("   ")).toEqual([]);
  });

  it("keeps short text in a single chunk", () => {
    expect(splitIntoSpeechChunks("Hello world.")).toEqual(["Hello world."]);
  });

  it("splits long text on sentence boundaries", () => {
    const text = `${"First sentence here. ".repeat(50)}${"Second sentence there. ".repeat(50)}`;
    const chunks = splitIntoSpeechChunks(text, { maxLength: 200 });

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200);
    }

    // No content is lost when chunking.
    expect(chunks.join(" ").replace(/\s+/g, " ").trim()).toBe(
      text.replace(/\s+/g, " ").trim(),
    );
  });

  it("hard-splits sentences longer than the chunk size", () => {
    const text = "x".repeat(2_500);
    const chunks = splitIntoSpeechChunks(text, { maxLength: 1_000 });

    expect(chunks.every((chunk) => chunk.length <= 1_000)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });
});
