// Verifies the chunking behind StreamingMarkdown: earlier chunks must
// never change while text streams in (only then can they stay
// memoized), code fences must be split into self-contained pieces, and
// every chunk must stay near the size cap so the growing tail is cheap
// to re-parse.

import { describe, expect, it } from "vitest";

import { buildChunks } from "./StreamingMarkdown";

const joinChunks = (
  chunks: ReturnType<typeof buildChunks>,
): string =>
  chunks
    .map((chunk) =>
      chunk.kind === "code"
        ? `\`\`\`${chunk.language}\n${chunk.text}\n\`\`\``
        : chunk.text,
    )
    .join("\n");

describe("buildChunks", () => {
  it("keeps settled chunks stable while the text grows", () => {
    const paragraphs = Array.from(
      { length: 40 },
      (_, index) =>
        `Paragraph ${index} with some Persian text متن فارسی برای آزمایش.`,
    );

    let previous = buildChunks(paragraphs[0]);

    for (let count = 2; count <= paragraphs.length; count += 1) {
      const current = buildChunks(
        paragraphs.slice(0, count).join("\n\n"),
      );

      // Every chunk that existed before must be unchanged.
      for (const index of previous.keys()) {
        expect(current[index]).toEqual(previous[index]);
      }

      previous = current;
    }
  });

  it("splits code fences into self-contained code chunks", () => {
    const codeLines = Array.from(
      { length: 80 },
      (_, index) => `  "key${index}": "value${index}",`,
    );

    const content = [
      "Intro text.",
      "",
      "```json",
      ...codeLines,
      "```",
      "",
      "Closing text.",
    ].join("\n");

    const chunks = buildChunks(content);

    const codeChunks = chunks.filter(
      (chunk) => chunk.kind === "code",
    );

    expect(codeChunks.length).toBeGreaterThan(1);

    for (const chunk of codeChunks) {
      expect(chunk.language).toBe("json");
      // No fence marker leaks into a code chunk body.
      expect(chunk.text).not.toMatch(/^\s*`{3,}/m);
    }

    const markdownTexts = chunks
      .filter((chunk) => chunk.kind === "markdown")
      .map((chunk) => chunk.text);

    expect(markdownTexts.join("\n")).toContain("Intro text.");
    expect(markdownTexts.join("\n")).toContain("Closing text.");
  });

  it("bounds the size of the growing tail", () => {
    const content = Array.from(
      { length: 400 },
      (_, index) => `line ${index} some streaming text`,
    ).join("\n");

    const chunks = buildChunks(content);

    // Only the final chunk keeps re-parsing while streaming, so no
    // chunk may grow far past the cap.
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThan(3000);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps an unclosed code fence in code mode until the end", () => {
    const chunks = buildChunks(
      ["Text.", "", "```js", "const a = 1;", "const b = 2;"].join(
        "\n",
      ),
    );

    const last = chunks[chunks.length - 1];

    expect(last.kind).toBe("code");
    expect(last.language).toBe("js");
    expect(last.text).toContain("const b = 2;");
  });

  it("does not treat prose backticks as a fence", () => {
    const content = "Use ``` for code and `x` for inline.";

    const chunks = buildChunks(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe("markdown");
  });

  it("round-trips code content through the wrapper", () => {
    const content = [
      "```python",
      "def hello():",
      "    return 1",
      "```",
    ].join("\n");

    const wrapped = joinChunks(buildChunks(content));

    expect(wrapped).toContain("```python");
    expect(wrapped).toContain("def hello():");
  });
});
