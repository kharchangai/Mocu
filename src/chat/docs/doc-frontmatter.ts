import { parse, stringify } from "yaml";

/**
 * Metadata stored in the YAML frontmatter of every mocu doc.
 *
 * Contract (new schema):
 *   id          stable, collision-safe identifier (slug), unique per document
 *   title       short human (and LLM) readable title
 *   description one or two sentences: what this doc explains and when to retrieve it
 *   keywords    search terms / synonyms used for keyword + BM25 search
 *
 * Legacy docs written before this schema used `name` instead of `title`
 * and had no `id`. They stay readable: `name` maps to `title`, and a
 * deterministic id is derived (from the file name when known, otherwise
 * from the title).
 */
export type DocFrontmatter = {
  /** Stable document identifier (slug), unique within the global docs folder. */
  id: string;
  /** Short human (and LLM) readable title of the document. */
  title: string;
  /** One or two sentences: what this doc explains and when to retrieve it. */
  description: string;
  /** Search terms / synonyms used to find the doc with keyword + BM25 search. */
  keywords: string[];
};

export type ParsedDoc = DocFrontmatter & {
  /** The explanatory markdown body (everything below the frontmatter). */
  body: string;
};

export type ParseDocOptions = {
  /**
   * File name of the doc inside the global docs folder (e.g. "my-doc.md").
   * Used to derive a deterministic, collision-safe id for legacy docs that
   * have no `id` in their frontmatter. File names are unique per folder,
   * so the derived id is unique too.
   */
  fileName?: string;
};

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Builds the final markdown file content for a doc:
 *
 *   ---
 *   id: ...
 *   title: ...
 *   description: ...
 *   keywords: [a, b, c]
 *   ---
 *   <body>
 *
 * The body is only trimmed at its edges, so descriptive markdown links
 * inside it are preserved verbatim.
 */
export function serializeDoc(
  meta: DocFrontmatter,
  body: string,
): string {
  const frontmatter = stringify({
    id: meta.id,
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords,
  });

  return `---\n${frontmatter}---\n${body.trim()}\n`;
}

/**
 * Parses a markdown doc with YAML frontmatter.
 * Returns null when the content has no parsable frontmatter.
 *
 * Accepts both the new schema (id/title/description/keywords) and the
 * legacy schema (name/description/keywords), mapping `name` to `title`
 * and deriving a deterministic id when the frontmatter has none.
 */
export function parseDoc(
  raw: string,
  options: ParseDocOptions = {},
): ParsedDoc | null {
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

  // New schema first, legacy `name` as fallback.
  const title =
    firstNonEmptyString(record.title) ?? firstNonEmptyString(record.name) ?? "";
  const description = firstNonEmptyString(record.description) ?? "";
  const keywords = normalizeKeywords(record.keywords);

  if (!title || !description) {
    return null;
  }

  return {
    id: resolveDocId(record, title, options.fileName),
    title,
    description,
    keywords,
    body: match[2].trim(),
  };
}

function firstNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Deterministic id resolution, in priority order:
 *   1. an explicit `id` frontmatter value (normalized to a slug),
 *   2. the doc's unique file name (when the caller knows it),
 *   3. the title slug.
 */
function resolveDocId(
  record: Record<string, unknown>,
  title: string,
  fileName?: string,
): string {
  const explicit = firstNonEmptyString(record.id);
  if (explicit) {
    return normalizeDocId(explicit);
  }

  if (fileName) {
    return normalizeDocId(fileName.replace(/\.md$/i, ""));
  }

  return normalizeDocId(title);
}

/**
 * Normalizes any value into a safe, stable document id (slug).
 * Falls back to "doc" when nothing usable remains.
 */
export function normalizeDocId(value: string): string {
  return docNameToSlug(value);
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

/** Converts a doc name/title into a safe file name, e.g. "My Cool Doc!" -> "my-cool-doc". */
export function docNameToSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-") // keep letters, digits and Persian/Arabic letters
    .replace(/^-+|-+$/g, "");

  return slug || "doc";
}
