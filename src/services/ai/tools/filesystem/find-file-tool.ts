/*
 * find_file tool — file discovery + content search with line numbers.
 *
 * Modelled on extensions-examples/filesystem/regex_search.ts (which stays
 * as an example): matches report file name, absolute path, matched text
 * and the line range the match covers, so the agent can jump straight to
 * read_file / edit_file with the right line numbers.
 *
 * The agent supplies an absolute root and a query describing what the user
 * wants to find. Short candidate patterns (agent-provided and/or derived
 * from query) gather possible matching lines; Jev then semantically judges
 * each candidate against the full query, like the filesystem semantic-search
 * example. File-name-only and direct regex searches are also supported.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { splitLines } from "./line-utils";
import {
  DEFAULT_RELEVANCE_THRESHOLD,
  MAX_JEV_QUESTIONS,
  MAX_QUERY_CHARS,
  filterByJevRelevance,
  type JevCandidate,
} from "./jev-relevance";
import {
  fileExists,
  readText,
  resolveAbsolutePath,
  walkFiles,
  utf8ByteLength,
} from "./fs-adapter";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PATTERN_CHARS = 256;
const MAX_CANDIDATE_PATTERNS = 16;
const MAX_RESULTS = 100;
const MATCH_TEXT_LIMIT = 300;

export type FindResult = {
  file_name: string;
  path: string;
  text: string;
  line_start: number;
  line_end: number;
  relevance?: number;
};

export const findFileInputSchema = z.object({
  root: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Absolute path of the directory to search in, e.g. 'E:\\\\project\\\\src'.",
    ),

  namePattern: z
    .string()
    .trim()
    .max(MAX_PATTERN_CHARS)
    .optional()
    .describe(
      "Optional PLAIN JavaScript regex tested against file names, e.g. '\\\\.(ts|tsx)$' or 'readme'. " +
        "No inline flags like (?i); never put natural-language sentences here - use query.",
    ),

  patterns: z
    .array(z.string().trim().min(1).max(MAX_PATTERN_CHARS))
    .max(MAX_CANDIDATE_PATTERNS)
    .optional()
    .describe(
      "Optional candidate-generation patterns: short case-insensitive JavaScript regexes that may match the requested word, phrase, identifier, or likely synonyms (e.g. ['password','credential','signIn']). They only gather candidate lines; query + Jev decide relevance. Never put a natural-language sentence in a pattern.",
    ),

  contentPattern: z
    .string()
    .trim()
    .max(MAX_PATTERN_CHARS)
    .optional()
    .describe(
      "Optional single case-insensitive JavaScript regex for a direct literal/structural content search, e.g. 'stocks?|shares?' or 'function\\\\s+login'. No inline flags like (?i); use query for natural language.",
    ),

  extensions: z
    .array(z.string())
    .optional()
    .describe(
      "Optional file-extension filter such as ['.ts', '.md']. Omit to search all text files.",
    ),

  query: z
    .string()
    .trim()
    .max(MAX_QUERY_CHARS)
    .optional()
    .describe(
      "The user's actual search goal in natural language, including the specific word, phrase, line, or behavior to locate (e.g. 'find the exact line that mentions password reset'). Jev judges every candidate against it. For meaning-based searches also supply broad patterns for likely wording/synonyms (query alone uses derived keywords). Combines with namePattern, patterns, contentPattern, and extensions.",
    ),

  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      `Minimum Jev relevance (0 to 1, default ${DEFAULT_RELEVANCE_THRESHOLD}) used when query is set.`,
    ),

  batchSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_JEV_QUESTIONS)
    .optional()
    .describe(
      `Excerpts judged per Jev call (1 to ${MAX_JEV_QUESTIONS}, default ${MAX_JEV_QUESTIONS}).`,
    ),
});

export type FindFileInput = z.infer<typeof findFileInputSchema>;

/**
 * Removes inline flag groups like (?i) or (?is) from a pattern and folds
 * their flags into the compiled regex.
 *
 * JavaScript regexes do not support bare inline modifiers, so an agent
 * writing Python-style '(?i)stocks?' would get 'Invalid group'. Since the
 * tools match case-insensitively by default anyway, this turns that
 * common mistake into a working pattern. Exported for tests.
 */
export function stripInlineFlags(pattern: string): {
  pattern: string;
  flags: string;
} {
  let flags = "";

  const collect = (inline: string): void => {
    for (const flag of inline) {
      if ("imsg".includes(flag) && !flags.includes(flag)) {
        flags += flag;
      }
    }
  };

  // Bare inline modifiers: "(?i)stocks" -> "stocks".
  let cleaned = pattern.replace(
    /\(\?([imsg]+)\)/g,
    (_match, inline: string) => {
      collect(inline);
      return "";
    },
  );

  // Inline modifier groups: "(?i:stock)" -> "(?:stock)".
  cleaned = cleaned.replace(
    /\(\?([imsg]+):/g,
    (_match, inline: string) => {
      collect(inline);
      return "(?:";
    },
  );

  return { pattern: cleaned, flags };
}

/**
 * Compiles one user pattern into a regex, with clear, actionable errors.
 */
export function compilePattern(
  pattern: string,
  flags: string,
  label: string,
): RegExp {
  if (!pattern) {
    throw new Error(`${label} must be a non-empty pattern.`);
  }

  if (pattern.length > MAX_PATTERN_CHARS) {
    throw new Error(
      `${label} must be at most ${MAX_PATTERN_CHARS} characters.`,
    );
  }

  const stripped = stripInlineFlags(pattern);
  const combinedFlags = [...new Set(flags + stripped.flags)].join("");

  try {
    return new RegExp(stripped.pattern, combinedFlags);
  } catch (error) {
    throw new Error(
      `Invalid ${label}: ${error instanceof Error ? error.message : String(error)}. ` +
        "Use PLAIN JavaScript regex syntax only: no inline flag groups like (?i) " +
        "(matching is already case-insensitive), no Python/PCRE-only constructs. " +
        "Good example: 'stocks?|shares?|stock market'. " +
        "For natural-language requests, pass query instead of a pattern.",
    );
  }
}

/**
 * Words too generic to be useful search keywords.
 */
const QUERY_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "these", "those", "about",
  "from", "into", "over", "under", "than", "then", "them", "they", "their",
  "there", "what", "when", "where", "which", "while", "who", "how", "why",
  "will", "would", "could", "should", "can", "may", "might", "must", "does",
  "did", "done", "doing", "have", "has", "had", "are", "was", "were", "been",
  "being", "not", "but", "any", "all", "some", "more", "most", "other", "such",
  "just", "also", "only", "very", "much", "many", "find", "found", "search",
  "look", "want", "need", "show", "give", "tell", "please", "describe",
  "identify", "contain", "contains", "containing", "include", "includes",
  "text", "file", "files", "folder", "document", "documents", "article",
  "articles", "item", "items", "thing", "things",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Derives a broad candidate regex from a natural-language query.
 *
 * Only used for candidate generation: the Jev decision model later keeps
 * just the semantically relevant excerpts, so recall matters more than
 * precision here (same split as extensions-examples/filesystem's
 * semantic_search: patterns generate candidates, query judges meaning).
 *
 * Returns null when the query has no usable keywords.
 */
export function deriveKeywordPattern(query: string): string | null {
  const words = query.match(/[\p{L}\p{N}]{2,}/gu) ?? [];

  const keywords = [
    ...new Set(
      words
        .map((word) => word.toLowerCase())
        .filter(
          (word) =>
            (word.length >= 4 || /[^\x00-\x7F]/.test(word)) &&
            !QUERY_STOPWORDS.has(word),
        ),
    ),
    // Longest (most specific) terms first.
  ].sort((a, b) => b.length - a.length);

  // Keep the pattern within the size limit.
  const picked: string[] = [];
  let length = 0;

  for (const keyword of keywords) {
    const cost = keyword.length + 1;
    if (length + cost > MAX_PATTERN_CHARS) {
      break;
    }
    picked.push(escapeRegExp(keyword));
    length += cost;
  }

  return picked.length > 0 ? picked.join("|") : null;
}

function truncateMatchText(text: string): string {
  return text.length > MATCH_TEXT_LIMIT
    ? `${text.slice(0, MATCH_TEXT_LIMIT)}…`
    : text;
}

export const findFileTool = tool(
  async ({ root, namePattern, patterns, contentPattern, extensions, query, threshold, batchSize }) => {
    try {
      if (!namePattern && !patterns?.length && !contentPattern && !query) {
        return [
          "Error: Provide at least one of: query, namePattern, patterns, contentPattern.",
          "- For a natural-language content search, pass query with the user's full search goal; Jev uses it to judge candidate lines.",
          "- Add broad patterns for likely words/synonyms, or let the tool derive candidates from query.",
          "- For a direct literal/regex search, pass contentPattern; for file names, pass namePattern.",
        ].join("\n");
      }

      const rootPath = await resolveAbsolutePath(root);

      if (!(await fileExists(rootPath))) {
        return `Error: Directory not found: ${rootPath}`;
      }

      const nameRegex = namePattern
        ? compilePattern(namePattern, "i", "namePattern")
        : null;

      /*
       * Patterns only gather candidate lines; the unmodified natural-language
       * query is sent to Jev to decide whether each candidate answers the
       * user's request. Include auto-derived terms as a recall fallback, and
       * also allow the agent to add likely synonyms/identifiers.
       */
      const candidatePatterns = [...(patterns ?? [])];
      if (contentPattern) candidatePatterns.push(contentPattern);

      let derivedNote = "";
      if (query) {
        const derived = deriveKeywordPattern(query);
        if (derived) {
          candidatePatterns.push(derived);
          derivedNote = `Additional candidate keywords derived from query: ${derived}`;
        }
      }

      const uniquePatterns = [...new Set(candidatePatterns)];
      if (uniquePatterns.length > MAX_CANDIDATE_PATTERNS + 2) {
        return `Error: Use at most ${MAX_CANDIDATE_PATTERNS} candidate patterns, one contentPattern, and the automatically derived query pattern.`;
      }

      if (!namePattern && uniquePatterns.length === 0) {
        return [
          "Error: query has no searchable keywords and no content pattern was provided.",
          "Add broad patterns for likely words/synonyms, or provide contentPattern for a direct literal/regex search.",
        ].join("\n");
      }

      const contentRegexes = uniquePatterns.map((pattern) =>
        compilePattern(pattern, "i", "pattern"),
      );

      const allowed = extensions?.length
        ? new Set(
            extensions.map((ext) =>
              `.${ext.replace(/^\./, "").toLowerCase()}`,
            ),
          )
        : null;

      const results: FindResult[] = [];

      for await (const file of walkFiles(rootPath)) {
        if (results.length >= MAX_RESULTS) {
          break;
        }

        if (allowed && !allowed.has(getFileExtension(file.name))) {
          continue;
        }

        const nameMatches = nameRegex ? nameRegex.test(file.name) : true;

        if (contentRegexes.length === 0) {
          if (nameMatches) {
            results.push({
              file_name: file.name,
              path: file.path,
              text: "",
              line_start: 0,
              line_end: 0,
            });
          }
          continue;
        }

        // Content search: the file must also pass the name filter.
        if (!nameMatches) {
          continue;
        }

        let content: string;
        try {
          content = await readText(file.path);
        } catch {
          continue; // binary or unreadable — skip
        }

        if (utf8ByteLength(content) > MAX_FILE_BYTES) {
          continue;
        }

        const lines = splitLines(content);

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_RESULTS) {
            break;
          }

          const matchesContent = contentRegexes.some((regex) => {
            regex.lastIndex = 0;
            return regex.test(lines[i]);
          });

          if (matchesContent) {
            results.push({
              file_name: file.name,
              path: file.path,
              text: truncateMatchText(lines[i].trim()),
              line_start: i + 1,
              line_end: i + 1,
            });
          }
        }
      }

      if (results.length === 0) {
        return [
          `No matches found in ${rootPath}.`,
          derivedNote,
        ]
          .filter(Boolean)
          .join("\n");
      }

      /*
       * Semantic filtering with the Jev decision model: keep only the
       * excerpts that are materially related to the query, each with its
       * relevance score. Falls back to the unfiltered matches when Jev is
       * not configured or the API call fails.
       */
      let jevNote = "";

      if (query && contentRegexes.length > 0) {
        const candidates: JevCandidate[] = results
          .filter((result) => result.line_start > 0)
          .map((result, index) => ({
            ...result,
            id: `candidate_${index + 1}`,
          }));

        try {
          const judged = await filterByJevRelevance(
            query,
            candidates,
            threshold ?? DEFAULT_RELEVANCE_THRESHOLD,
            batchSize ?? MAX_JEV_QUESTIONS,
          );

          results.length = 0;
          results.push(
            ...judged
              .sort((a, b) => b.relevance - a.relevance)
              .map(({ id: _id, ...candidate }) => candidate),
          );

          jevNote = `Jev relevance filter applied (query: "${query.trim()}", threshold ${threshold ?? DEFAULT_RELEVANCE_THRESHOLD}).`;
        } catch (error) {
          jevNote =
            `Jev relevance filter unavailable, returning unfiltered matches: ` +
            `${error instanceof Error ? error.message : String(error)}`;
        }
      }

      if (results.length === 0) {
        return [
          `No relevant matches found in ${rootPath}.`,
          derivedNote,
          jevNote,
        ]
          .filter(Boolean)
          .join("\n");
      }

      const lines: string[] = [
        `Found ${results.length} match(es) in ${rootPath}` +
          (results.length >= MAX_RESULTS ? ` (result limit ${MAX_RESULTS} reached)` : "") +
          ":",
      ];

      if (derivedNote) {
        lines.push(derivedNote);
      }

      if (jevNote) {
        lines.push(jevNote);
      }

      if (derivedNote || jevNote) {
        lines.push("");
      }

      for (const result of results) {
        if (result.line_start === 0) {
          lines.push(`- ${result.path}`);
        } else {
          const score =
            typeof result.relevance === "number"
              ? ` [relevance ${result.relevance.toFixed(2)}]`
              : "";
          lines.push(
            `- ${result.path} (lines ${result.line_start}-${result.line_end})${score}: ${result.text}`,
          );
        }
      }

      lines.push(
        "",
        "Use these line numbers with read_file (offset/limit) and edit_file (startLine/endLine).",
      );

      return lines.join("\n");
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "find_file",
    description:
      "Searches a directory for files and matching content. Always pass root (the absolute directory) and, for content searches, query (the user's full request describing the word, phrase, line, code behavior, or information to find). " +
      "For semantic searches, also provide patterns: up to 16 short plain JavaScript regex hints for candidate words, synonyms, or identifiers. These only gather candidate lines; Jev judges each line against query and returns relevant results with paths, line numbers, and scores. The tool also adds query-derived terms as a fallback. " +
      "Use contentPattern for a direct literal/regex search or namePattern for file names. Do not convert a whole natural-language request into a regex. " +
      "Patterns are case-insensitive; inline flag groups like (?i) are stripped. Hidden folders and build folders (node_modules, target, dist, ...) are skipped. " +
      "In project chats, use the active project path as root unless the user specifies another location.",
    schema: findFileInputSchema,
  },
);

function getFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export default findFileTool;
