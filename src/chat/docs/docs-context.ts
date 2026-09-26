import { searchDocs } from "./doc-search";

/** How many doc hints are injected at most. */
const MAX_DOCS = 2;

/**
 * Builds a tiny system-prompt hint for a user message, or "" when no saved
 * doc matches.
 *
 * The hint is ONE line: it only names the matching docs. No content, no
 * metadata. If the agent cares, it calls the read_knowledge_doc tool.
 *
 * Never throws: callers can safely await this before building the prompt.
 */
export async function buildDocsContextPrompt(
  userText: string,
  options: {
    docsLimit?: number;
  } = {},
): Promise<string> {
  const trimmedInput = userText.trim();

  if (!trimmedInput) {
    return "";
  }

  let results: Awaited<ReturnType<typeof searchDocs>> = [];

  try {
    results = await searchDocs(trimmedInput, options.docsLimit ?? MAX_DOCS);
  } catch (error) {
    console.warn("[Docs Context] Doc hint search failed:", error);
    return "";
  }

  if (results.length === 0) {
    return "";
  }

  return `SAVED DOCS: ${results
    .map((result) => `"${result.doc.file}"`)
    .join(", ")} — may relate to the user's message. Call read_knowledge_doc if you need their content, otherwise ignore.`;
}
