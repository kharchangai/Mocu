import { searchDocs } from "./doc-search";
import type { StoredDoc } from "./doc-storage";

/**
 * System-prompt doc context.
 *
 * Builds a tiny, FAIL-OPEN hint from the bounded hybrid search results:
 *
 *   - only the selected document REFERENCES are named (file name + the
 *     approved frontmatter metadata: id / title / description / keywords);
 *   - NEVER the body, never search snippets, never scores, and never any
 *     linked document: Markdown links inside a doc are descriptive leads
 *     the agent follows ITSELF by calling read_knowledge_doc with the
 *     linked file name — nothing is auto-traversed or crawled here;
 *   - at most `docsLimit` (default MAX_CONTEXT_DOCS) references are emitted,
 *     on top of the search's own relevance threshold + result cap;
 *   - any search failure degrades to "" (no hint), so callers can always
 *     await this before building the prompt.
 */

/** How many doc references are injected at most. */
export const MAX_CONTEXT_DOCS = 2;

/** Per-field truncation budgets for the approved metadata. */
export const MAX_CONTEXT_TITLE_CHARS = 120;
export const MAX_CONTEXT_DESCRIPTION_CHARS = 240;
export const MAX_CONTEXT_KEYWORD_CHARS = 60;
export const MAX_CONTEXT_KEYWORDS = 8;

export type DocsContextOptions = {
  /** Reference cap for this call; invalid values fall back to the default. */
  docsLimit?: number;
};

/**
 * Escapes untrusted metadata so it renders as inert text inside the prompt:
 * markdown emphasis/structure characters, brackets, angle brackets and all
 * control characters (including newlines) are neutralized.
 */
export function escapeDocsMetadata(value: string): string {
  return value
    // Control characters (incl. CR/LF) collapse into a single space.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/#/g, "\\#")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .trim();
}

function truncate(value: string, maxChars: number): string {
  const normalized = escapeDocsMetadata(value);
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars).trimEnd()}…`
    : normalized;
}

/** Resolves the reference cap; invalid values fall back to the default. */
function resolveContextCap(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return MAX_CONTEXT_DOCS;
  }
  const floored = Math.floor(limit);
  return floored >= 1 ? floored : MAX_CONTEXT_DOCS;
}

/** One reference entry: file name + approved metadata only (no body). */
function formatReference(doc: StoredDoc): string {
  const keywords = doc.keywords
    .filter((keyword) => typeof keyword === "string" && keyword.trim())
    .slice(0, MAX_CONTEXT_KEYWORDS)
    .map((keyword) => truncate(keyword, MAX_CONTEXT_KEYWORD_CHARS))
    .join(", ");

  return [
    `- file: "${truncate(doc.file, MAX_CONTEXT_TITLE_CHARS)}"`,
    `id: ${truncate(doc.id, MAX_CONTEXT_TITLE_CHARS)}`,
    `title: ${truncate(doc.title, MAX_CONTEXT_TITLE_CHARS)}`,
    `description: ${truncate(doc.description, MAX_CONTEXT_DESCRIPTION_CHARS)}`,
    `keywords: ${keywords || "(none)"}`,
  ].join(" | ");
}

/**
 * Builds the doc-reference hint for a user message, or "" when no saved doc
 * matches (or the search fails — fail-open: never blocks the agent).
 *
 * The hint contains ONLY capped references + approved metadata. It explicitly
 * tells the agent that links are descriptive leads it must follow itself via
 * read_knowledge_doc — no link targets are resolved or fetched here.
 */
export async function buildDocsContextPrompt(
  userText: string,
  options: DocsContextOptions = {},
): Promise<string> {
  const trimmedInput = userText.trim();

  if (!trimmedInput) {
    return "";
  }

  const cap = resolveContextCap(options.docsLimit);

  let results: Awaited<ReturnType<typeof searchDocs>> = [];

  try {
    results = await searchDocs(trimmedInput, cap);
  } catch (error) {
    console.warn("[Docs Context] Doc hint search failed:", error);
    return "";
  }

  // Threshold + search cap already filtered; this is the context-level cap.
  const selected = results.slice(0, cap);

  if (selected.length === 0) {
    return "";
  }

  return [
    `SAVED DOCS (references only — metadata, never content; max ${cap}):`,
    ...selected.map((result) => formatReference(result.doc)),
    "Read a doc only when needed with read_knowledge_doc(fileName). Links inside docs are descriptive leads: decide yourself whether to follow one by calling read_knowledge_doc again with the linked file name (pass currentDoc as the document you are reading). Links are never resolved, read or fetched automatically — no crawling, no extra model calls.",
  ].join("\n");
}