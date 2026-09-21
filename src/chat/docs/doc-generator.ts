import { getAsyncLLM } from "../../services/ai/llm";
import { parseDoc } from "./doc-frontmatter";
import type { DocFrontmatter } from "./doc-frontmatter";
import { readDoc, saveDoc, writeDocFile } from "./doc-storage";

/**
 * Asks the LLM to turn raw user text into a complete, searchable markdown
 * document. The model must answer with a single markdown file that starts
 * with YAML frontmatter (name / description / keywords) followed by a body
 * that fully explains the input text.
 */
const DOC_CREATION_SYSTEM_PROMPT = `You create searchable knowledge documents for an agent's retrieval system.

You receive raw text (notes, an idea, a conversation snippet, a request the user made, ...). Your job is to turn it into ONE complete markdown document so that, later, an LLM agent can find this document with keyword/BM25 search and understand EXACTLY what the user meant.

Answer with the markdown document ONLY. No explanations before or after. IMPORTANT: in the frontmatter, the keywords field MUST be a YAML list (one "- item" per line), never a comma-separated string. The document must have this exact shape:

---
name: <short title, 2-6 words, Title Case>
description: <1-2 sentences: what this document explains AND when an agent should retrieve it>
keywords:
  - <keyword 1>
  - <keyword 2>
  - <5-15 search keywords total, including synonyms and likely wording of a future user question>
---

# <the same title>

Then the body, which must:
- Fully explain the text that was given to you: the goal, the context, the important details.
- Be self-contained: a reader who never saw the original input must understand everything.
- Use short markdown sections and bullet points (## headings) where useful.
- Include concrete details (names, values, constraints, steps) from the input instead of vague statements.
- End with a short "## When to use this document" section describing the situations/requests it should be retrieved for.

Write the document in the same language as the input text.`;

export type CreateDocOptions = {
  /** LLM tier used to generate the document. Defaults to "cheap". */
  tier?: "cheap" | "medium" | "expensive";
};

export type CreatedDoc = DocFrontmatter & {
  /** File name of the saved document inside the global docs folder. */
  file: string;
  /** The explanatory markdown body. */
  body: string;
};

export type UpdateDocOptions = CreateDocOptions & {
  /** Maximum length of the text sent to the LLM. */
  maxInputChars?: number;
};

/**
 * Regenerates an EXISTING doc from new text via the LLM and overwrites the
 * same file. Returns the updated doc.
 */
export async function updateDocFromText(
  fileName: string,
  newText: string,
  options: UpdateDocOptions = {},
): Promise<CreatedDoc> {
  const existing = await readDoc(fileName);

  if (!existing) {
    throw new Error(`No document named "${fileName}" exists to update.`);
  }

  const maxChars = options.maxInputChars ?? 12_000;
  const trimmedInput = newText.trim().slice(0, maxChars);

  if (!trimmedInput) {
    throw new Error("Cannot update a doc from empty text.");
  }

  const llm = await getAsyncLLM(options.tier ?? "cheap", {
    temperature: 0.2,
  });

  const response = await llm.invoke([
    ["system", DOC_CREATION_SYSTEM_PROMPT],
    [
      "human",
      [
        "Update the existing knowledge document below using the new text.",
        "Keep the same YAML frontmatter shape (name, description, keywords as a YAML list).",
        "Merge the new information into the document; keep existing details that are still correct.",
        "",
        `EXISTING DOCUMENT "${existing.file}":`,
        serializeExistingDoc(existing),
        "",
        "NEW TEXT:",
        trimmedInput,
      ].join("\n"),
    ],
  ]);

  const raw = extractText(response.content);
  const { meta, body } = splitGeneratedDoc(raw, trimmedInput);

  await writeDocFile(existing.file, meta, body);

  return { ...meta, file: existing.file, body };
}

export type DocFieldUpdates = {
  name?: string;
  description?: string;
  keywords?: string[];
  body?: string;
};

/**
 * Direct field edit of an existing doc (no LLM call). Used by the docs UI
 * editor and the agent update tool when exact values are already known.
 */
export async function updateDocFields(
  fileName: string,
  updates: DocFieldUpdates,
): Promise<CreatedDoc> {
  const existing = await readDoc(fileName);

  if (!existing) {
    throw new Error(`No document named "${fileName}" exists to update.`);
  }

  const meta: DocFrontmatter = {
    name: updates.name?.trim() || existing.name,
    description: updates.description?.trim() || existing.description,
    keywords:
      updates.keywords === undefined
        ? existing.keywords
        : updates.keywords.map((k) => k.trim()).filter(Boolean),
  };

  const body = updates.body === undefined ? existing.body : updates.body;

  await writeDocFile(existing.file, meta, body);

  return { ...meta, file: existing.file, body };
}

function serializeExistingDoc(doc: {
  name: string;
  description: string;
  keywords: string[];
  body: string;
}): string {
  return [
    "---",
    `name: ${doc.name}`,
    `description: ${doc.description}`,
    `keywords:\n${doc.keywords.map((k) => `  - ${k}`).join("\n")}`,
    "---",
    doc.body,
  ].join("\n");
}

/**
 * Takes raw text, asks the LLM to generate a complete searchable markdown
 * document for it, and saves the document in the global mocu docs folder
 * (BaseDirectory.AppData/docs).
 */
export async function createDocFromText(
  inputText: string,
  options: CreateDocOptions = {},
): Promise<CreatedDoc> {
  const trimmedInput = inputText.trim();

  if (!trimmedInput) {
    throw new Error("Cannot create a doc from empty text.");
  }

  const llm = await getAsyncLLM(options.tier ?? "cheap", {
    temperature: 0.2,
  });

  const response = await llm.invoke([
    ["system", DOC_CREATION_SYSTEM_PROMPT],
    ["human", trimmedInput],
  ]);

  const raw = extractText(response.content);
  const { meta, body } = splitGeneratedDoc(raw, trimmedInput);

  const file = await saveDoc(meta, body);

  return { ...meta, file, body };
}

function extractText(content: string | Array<unknown>): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) =>
      part !== null && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
}

/**
 * Extracts name / description / keywords and the body from the generated
 * markdown. Falls back to derived metadata when the LLM answers without
 * valid frontmatter, so a useful document is still saved.
 */
function splitGeneratedDoc(
  raw: string,
  inputText: string,
): { meta: DocFrontmatter; body: string } {
  const match = raw.trim().match(
    /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
  );

  if (match) {
    const parsed = parseDoc(raw);
    if (parsed) {
      return {
        meta: {
          name: parsed.name,
          description: parsed.description,
          keywords: parsed.keywords,
        },
        body: parsed.body,
      };
    }

    // Frontmatter existed but was invalid: keep the body below it.
    return {
      meta: fallbackMeta(inputText),
      body: match[2].trim() || raw.trim(),
    };
  }

  return { meta: fallbackMeta(inputText), body: raw.trim() };
}

function fallbackMeta(inputText: string): DocFrontmatter {
  const firstLine =
    inputText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Saved text";

  return {
    name: firstLine.slice(0, 60),
    description: firstLine.slice(0, 200),
    keywords: tokenizeKeywords(inputText).slice(0, 10),
  };
}

function tokenizeKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u0600-\u06FF]+/)
        .filter((token) => token.length > 3),
    ),
  );
}
