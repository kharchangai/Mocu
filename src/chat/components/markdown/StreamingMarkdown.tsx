// src/chat/components/markdown/StreamingMarkdown.tsx
//
// Markdown renderer for a response that is still streaming in.
//
// Re-parsing the FULL accumulated text with react-markdown + syntax
// highlighting on every delta gets slower as the response grows. With a
// very long answer the chat stops keeping up: the visible text freezes
// (only a section renders, older text goes blank) and nothing new shows
// until the whole stream finishes.
//
// This renderer splits the accumulated text into stable chunks
// (paragraphs, code-fence segments and size-capped pieces) and renders
// every settled chunk through the memoized MarkdownRenderer. The text
// only ever grows at the end, so earlier chunks keep identical strings
// and never re-parse — each delta only re-parses the small growing tail,
// no matter how long the response gets.

import { memo } from "react";

import { MarkdownRenderer } from "./MarkdownRenderer";

/*
 * Rough size cap for one chunk. Only the last chunk (the growing tail)
 * is re-parsed while streaming, so a smaller cap streams smoother while
 * a bigger cap means fewer DOM nodes.
 */
const MAX_CHUNK_CHARS = 1200;

/*
 * A standalone fence line: ``` / ~~~ optionally followed by a language
 * tag. Prose like "use ``` for code" does not count.
 */
const FENCE_LINE_PATTERN =
  /^\s{0,3}(`{3,}|~{3,})\s*[\w#+.-]*\s*$/;

type StreamChunk = {
  kind: "markdown" | "code";
  language: string;
  text: string;
};

export type { StreamChunk };

const readFenceLanguage = (
  line: string,
  markerLength: number,
): string => {
  const tag = line
    .trim()
    .slice(markerLength)
    .trim()
    .split(/[\s:,{(]/)[0]
    ?.toLowerCase();

  return tag ?? "";
};

/*
 * Splits the accumulated text into chunks whose boundaries never move
 * once the text has grown past them:
 *
 *   - a fence line closes the current chunk and opens a code chunk
 *     (the marker line itself is dropped — code chunks are wrapped in
 *     their own fence when rendered);
 *   - a blank line closes a markdown chunk (paragraph boundary);
 *   - chunks are hard-split at line boundaries past MAX_CHUNK_CHARS.
 */
export const buildChunks = (
  content: string,
): StreamChunk[] => {
  const chunks: StreamChunk[] = [];

  let buffer: string[] = [];
  let bufferChars = 0;
  let bufferKind: "markdown" | "code" = "markdown";
  let bufferLanguage = "";
  let fenceOpen = false;
  let fenceLanguage = "";

  const flush = (): void => {
    if (buffer.length === 0) {
      return;
    }

    const text = buffer.join("\n");

    if (text.trim()) {
      chunks.push({
        kind: bufferKind,
        language: bufferLanguage,
        text,
      });
    }

    buffer = [];
    bufferChars = 0;
  };

  for (const line of content.split("\n")) {
    const fence = FENCE_LINE_PATTERN.exec(line);

    if (fence) {
      flush();

      fenceOpen = !fenceOpen;

      if (fenceOpen) {
        fenceLanguage = readFenceLanguage(
          line,
          fence[1].length,
        );
      }

      continue;
    }

    const kind = fenceOpen ? "code" : "markdown";

    /*
     * A blank line in prose closes the paragraph chunk. The blank
     * line itself is dropped (the renderer trims chunks anyway), so
     * the settled chunk text does not change when the next paragraph
     * arrives.
     */
    if (kind === "markdown" && line.trim() === "") {
      flush();
      continue;
    }

    bufferKind = kind;
    bufferLanguage = fenceOpen ? fenceLanguage : "";
    buffer.push(line);
    bufferChars += line.length + 1;

    const cap =
      kind === "code"
        ? MAX_CHUNK_CHARS
        : MAX_CHUNK_CHARS * 2;

    if (bufferChars >= cap) {
      flush();
    }
  }

  flush();

  return chunks;
};

/*
 * One settled markdown chunk. Memoized on the chunk text: an unchanged
 * chunk never re-runs markdown parsing.
 */
const MarkdownChunk = memo(function MarkdownChunk({
  text,
}: {
  text: string;
}) {
  return (
    <MarkdownRenderer content={text} direction="auto" />
  );
});

/*
 * One settled piece of a code fence, wrapped in its own fence so it
 * keeps the same syntax highlighting as the final render.
 */
const CodeChunk = memo(function CodeChunk({
  language,
  body,
}: {
  language: string;
  body: string;
}) {
  return (
    <MarkdownRenderer
      content={`\`\`\`${language}\n${body}\n\`\`\``}
      direction="auto"
    />
  );
});

export type StreamingMarkdownProps = {
  content: string;
};

export const StreamingMarkdown = memo(
  function StreamingMarkdown({
    content,
  }: StreamingMarkdownProps) {
    if (!content || !content.trim()) {
      return null;
    }

    const chunks = buildChunks(content);

    return (
      <>
        {chunks.map((chunk, index) =>
          chunk.kind === "code" ? (
            <CodeChunk
              key={index}
              language={chunk.language}
              body={chunk.text}
            />
          ) : (
            <MarkdownChunk
              key={index}
              text={chunk.text}
            />
          ),
        )}
      </>
    );
  },
);