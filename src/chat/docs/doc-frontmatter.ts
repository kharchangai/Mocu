import { parse, stringify } from "yaml";

/**
 * Metadata stored in the YAML frontmatter of every mocu doc.
 * These fields are what BM25 search and the future agent tool rely on.
 */
export type DocFrontmatter = {
  /** Short human (and LLM) readable title of the document. */
  name: string;
  /** One or two sentences: what this doc explains and when to retrieve it. */
  description: string;
  /** Search terms / synonyms used to find the doc with keyword + BM25 search. */
  keywords: string[];
};

export type ParsedDoc = DocFrontmatter & {
  /** The explanatory markdown body (everything below the frontmatter). */
  body: string;
};

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Builds the final markdown file content for a doc:
 *
 *   ---
 *   name: ...
 *   description: ...
 *   keywords: [a, b, c]
 *   ---
 *   <body>
 */
export function serializeDoc(
  meta: DocFrontmatter,
  body: string,
): string {
  const frontmatter = stringify({
    name: meta.name,
    description: meta.description,
    keywords: meta.keywords,
  });

  return `---\n${frontmatter}---\n${body.trim()}\n`;
}

/**
 * Parses a markdown doc with YAML frontmatter.
 * Returns null when the content has no parsable frontmatter.
 */
export function parseDoc(raw: string): ParsedDoc | null {
  // Tolerate LLM output wrapped in a ```markdown fence.
  const fenced = raw.trim().match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/);
  const content = fenced ? fenced[1] : raw.trim();

  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return null;
  }

  let data: unknown;
  try {
    data = parse(match[1]);
  } catch {
    return null;
  }

  if (data === null || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  const keywords = normalizeKeywords(record.keywords);

  if (!name || !description) {
    return null;
  }

  return { name, description, keywords, body: match[2].trim() };
}

/**
 * LLMs often emit keywords either as a YAML list or as a single
 * comma-separated string. Accept both shapes:
 *
 *   keywords: [a, b, c]
 *   keywords: a, b, c
 */
function normalizeKeywords(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    const keywords: string[] = [];

    for (const entry of value) {
      if (typeof entry === "string") {
        // Split array items too, in case one item holds several keywords.
        keywords.push(
          ...entry
            .split(",")
            .map((keyword) => keyword.trim())
            .filter(Boolean),
        );
      }
    }

    return keywords;
  }

  return [];
}

/** Converts a doc name into a safe file name, e.g. "My Cool Doc!" -> "my-cool-doc". */
export function docNameToSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-") // keep letters, digits and Persian/Arabic letters
    .replace(/^-+|-+$/g, "");

  return slug || "doc";
}
