import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {
  Code,
  Content,
  Heading,
  Root,
} from "mdast";

export type AgentSpanType =
  | "paragraph"
  | "code"
  | "list"
  | "table"
  | "blockquote"
  | "html"
  | "thematic_break"
  | "mixed"
  | "unknown";

export interface AgentSpan {
  /**
   * Full heading path associated with the span.
   *
   * Example:
   * Using SQLite in Tauri > Installation
   */
  tag: string;

  /**
   * Type of content stored in the span.
   *
   * If a section contains more than one block type,
   * its type will be "mixed".
   */
  type: AgentSpanType;

  /**
   * Complete Markdown content under the heading.
   *
   * Paragraphs, code blocks, lists and tables remain together
   * until the next heading is reached.
   */
  content: string;

  /**
   * Approximate token count for both tag and content.
   */
  estimatedTokenCount: number;

  /**
   * Languages found in fenced code blocks.
   */
  languages?: string[];
}

export interface CreateAgentSpansOptions {
  /**
   * Optional custom token counter.
   */
  countTokens?: (text: string) => number;

  /**
   * Tag assigned to content before the first heading.
   *
   * Default: "untitled"
   */
  defaultTag?: string;

  /**
   * Whether nested heading names should be included in the tag.
   *
   * Example:
   * Main Heading > Child Heading
   *
   * Default: true
   */
  useHeadingPath?: boolean;

  /**
   * Removes indentation caused by indented template literals.
   *
   * Default: true
   */
  removeTemplateIndentation?: boolean;
}

interface SectionBlock {
  content: string;
  type: AgentSpanType;
  language?: string;
}

interface PendingSection {
  tag: string;
  blocks: SectionBlock[];
}

/**
 * Converts Markdown sections into independent spans.
 *
 * Rules:
 *
 * 1. A heading is used as the span tag.
 * 2. A heading is not emitted as an independent span.
 * 3. Everything under a heading stays in one span.
 * 4. A paragraph followed by code stays in the same span.
 * 5. A list or table following code also stays in the same span.
 * 6. A new heading closes the current span.
 */
export function createAgentSpans(
  markdown: string,
  options: CreateAgentSpansOptions = {},
): AgentSpan[] {
  const countTokens =
    options.countTokens ?? estimateTokenCount;

  const defaultTag =
    options.defaultTag?.trim() || "untitled";

  const useHeadingPath =
    options.useHeadingPath ?? true;

  const removeTemplateIndentation =
    options.removeTemplateIndentation ?? true;

  const normalizedMarkdown = normalizeMarkdown(
    markdown,
    removeTemplateIndentation,
  );

  if (normalizedMarkdown.length === 0) {
    return [];
  }

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm);

  const tree = processor.parse(normalizedMarkdown) as Root;

  const spans: AgentSpan[] = [];
  const headingPath: string[] = [];

  let activeTag = defaultTag;

  let pendingSection: PendingSection = {
    tag: activeTag,
    blocks: [],
  };

  const flushPendingSection = (): void => {
    const span = createSpanFromSection(
      pendingSection,
      countTokens,
    );

    if (span) {
      spans.push(span);
    }

    pendingSection = {
      tag: activeTag,
      blocks: [],
    };
  };

  for (const node of tree.children) {
    if (node.type === "heading") {
      flushPendingSection();

      const heading = extractHeading(node);

      activeTag = updateHeadingPath({
        heading,
        headingPath,
        defaultTag,
        useHeadingPath,
      });

      pendingSection = {
        tag: activeTag,
        blocks: [],
      };

      continue;
    }

    const block = createSectionBlock(
      node,
      normalizedMarkdown,
    );

    if (!block) {
      continue;
    }

    /*
     * Every block remains in the current section.
     *
     * Code does not flush the previous paragraph and does not
     * create a separate span.
     */
    pendingSection.blocks.push(block);
  }

  flushPendingSection();

  return spans;
}

interface UpdateHeadingPathInput {
  heading: Heading;
  headingPath: string[];
  defaultTag: string;
  useHeadingPath: boolean;
}

function updateHeadingPath({
  heading,
  headingPath,
  defaultTag,
  useHeadingPath,
}: UpdateHeadingPathInput): string {
  const headingText =
    extractPlainText(heading).trim() || defaultTag;

  if (!useHeadingPath) {
    return headingText;
  }

  const headingIndex = heading.depth - 1;

  headingPath.length = headingIndex;
  headingPath[headingIndex] = headingText;

  return headingPath
    .filter((item): item is string => Boolean(item))
    .join(" > ");
}

function createSectionBlock(
  node: Content,
  markdown: string,
): SectionBlock | null {
  const startOffset = node.position?.start.offset;
  const endOffset = node.position?.end.offset;

  if (
    typeof startOffset !== "number" ||
    typeof endOffset !== "number" ||
    endOffset <= startOffset
  ) {
    return null;
  }

  const content = markdown
    .slice(startOffset, endOffset)
    .trim();

  if (content.length === 0) {
    return null;
  }

  if (node.type === "code") {
    return createCodeBlock(node, content);
  }

  return {
    content,
    type: mapNodeType(node),
  };
}

function createCodeBlock(
  node: Code,
  content: string,
): SectionBlock {
  return {
    content,
    type: "code",
    language: node.lang ?? undefined,
  };
}

function createSpanFromSection(
  section: PendingSection,
  countTokens: (text: string) => number,
): AgentSpan | null {
  if (section.blocks.length === 0) {
    return null;
  }

  const content = section.blocks
    .map((block) => block.content)
    .join("\n\n")
    .trim();

  if (content.length === 0) {
    return null;
  }

  const languages = getCodeLanguages(section.blocks);

  const span: AgentSpan = {
    tag: section.tag,
    type: determineSpanType(section.blocks),
    content,
    estimatedTokenCount: countTokens(
      `${section.tag}\n\n${content}`,
    ),
  };

  if (languages.length > 0) {
    span.languages = languages;
  }

  return span;
}

/**
 * A section with one block type uses that type.
 * A section with multiple block types becomes "mixed".
 */
function determineSpanType(
  blocks: SectionBlock[],
): AgentSpanType {
  if (blocks.length === 0) {
    return "unknown";
  }

  const uniqueTypes = new Set(
    blocks.map((block) => block.type),
  );

  if (uniqueTypes.size === 1) {
    return blocks[0].type;
  }

  return "mixed";
}

function getCodeLanguages(
  blocks: SectionBlock[],
): string[] {
  return [
    ...new Set(
      blocks
        .map((block) => block.language)
        .filter(
          (language): language is string =>
            typeof language === "string" &&
            language.length > 0,
        ),
    ),
  ];
}

function mapNodeType(
  node: Content,
): AgentSpanType {
  switch (node.type) {
    case "paragraph":
      return "paragraph";

    case "code":
      return "code";

    case "list":
      return "list";

    case "table":
      return "table";

    case "blockquote":
      return "blockquote";

    case "html":
      return "html";

    case "thematicBreak":
      return "thematic_break";

    default:
      return "unknown";
  }
}

function extractHeading(node: Heading): Heading {
  return node;
}

/**
 * Extracts readable text from an MDAST node.
 */
function extractPlainText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractPlainText(item))
      .join("")
      .trim();
  }

  if (typeof value !== "object") {
    return "";
  }

  const node = value as Record<string, unknown>;

  if (typeof node.value === "string") {
    return node.value;
  }

  if (Array.isArray(node.children)) {
    return node.children
      .map((child) => extractPlainText(child))
      .join("")
      .trim();
  }

  if (typeof node.alt === "string") {
    return node.alt;
  }

  return "";
}

function normalizeMarkdown(
  markdown: string,
  removeTemplateIndentation: boolean,
): string {
  const normalized = markdown
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!removeTemplateIndentation) {
    return normalized;
  }

  return removeCommonIndentation(normalized);
}

/**
 * Removes indentation introduced by a template literal
 * while preserving relative Markdown indentation.
 */
function removeCommonIndentation(
  markdown: string,
): string {
  const lines = markdown.split("\n");

  if (lines.length <= 1) {
    return markdown;
  }

  const nonEmptyLines = lines.filter(
    (line) => line.trim().length > 0,
  );

  if (nonEmptyLines.length === 0) {
    return markdown;
  }

  const indentationLengths = nonEmptyLines.map(
    getIndentationLength,
  );

  const firstIndentation = indentationLengths[0];

  if (firstIndentation > 0) {
    const minimumIndentation = Math.min(
      ...indentationLengths,
    );

    if (minimumIndentation <= 0) {
      return markdown;
    }

    return lines
      .map((line) =>
        removeIndentation(
          line,
          minimumIndentation,
        ),
      )
      .join("\n");
  }

  const remainingNonEmptyLines = lines
    .slice(1)
    .filter((line) => line.trim().length > 0);

  if (remainingNonEmptyLines.length === 0) {
    return markdown;
  }

  const allRemainingLinesAreIndented =
    remainingNonEmptyLines.every(
      (line) => getIndentationLength(line) > 0,
    );

  if (!allRemainingLinesAreIndented) {
    return markdown;
  }

  const minimumRemainingIndentation = Math.min(
    ...remainingNonEmptyLines.map(
      getIndentationLength,
    ),
  );

  if (minimumRemainingIndentation <= 0) {
    return markdown;
  }

  return lines
    .map((line, index) => {
      if (
        index === 0 ||
        line.trim().length === 0
      ) {
        return line;
      }

      return removeIndentation(
        line,
        minimumRemainingIndentation,
      );
    })
    .join("\n");
}

function getIndentationLength(
  line: string,
): number {
  return line.match(/^[\t ]*/)?.[0].length ?? 0;
}

function removeIndentation(
  line: string,
  indentationLength: number,
): string {
  if (line.trim().length === 0) {
    return "";
  }

  let position = 0;
  let removedCharacters = 0;

  while (
    position < line.length &&
    removedCharacters < indentationLength
  ) {
    const character = line[position];

    if (
      character !== " " &&
      character !== "\t"
    ) {
      break;
    }

    position += 1;
    removedCharacters += 1;
  }

  return line.slice(position);
}

/**
 * Approximate token counter.
 *
 * A real tokenizer can be supplied through options.countTokens.
 */
export function estimateTokenCount(
  text: string,
): number {
  const normalized = text.trim();

  if (normalized.length === 0) {
    return 0;
  }

  const latinWords =
    normalized.match(
      /[A-Za-z0-9_]+(?:['’-][A-Za-z0-9_]+)*/g,
    ) ?? [];

  const nonLatinCharacters =
    normalized.match(
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u4E00-\u9FFF]/g,
    ) ?? [];

  const punctuation =
    normalized.match(
      /[{}[\]()<>=+\-*/\\|`~!@#$%^&:;,.?]/g,
    ) ?? [];

  const lineBreaks =
    normalized.match(/\n/g) ?? [];

  const estimate =
    latinWords.length * 1.25 +
    nonLatinCharacters.length * 0.55 +
    punctuation.length * 0.35 +
    lineBreaks.length * 0.2;

  return Math.max(1, Math.ceil(estimate));
}