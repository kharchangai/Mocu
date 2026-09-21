import { Bm25Index, tokenize } from "./bm25";
import { readAllDocs } from "./doc-storage";
import type { StoredDoc } from "./doc-storage";

/**
 * Searchable representation of one doc for BM25. Name and keywords are
 * repeated so exact keyword hits outrank body mentions.
 */
function docToSearchText(doc: StoredDoc): string {
  return [
    doc.name,
    doc.name,
    doc.keywords.join(" "),
    doc.keywords.join(" "),
    doc.keywords.join(" "),
    doc.description,
    doc.body,
  ].join("\n");
}

export type DocSearchResult = {
  doc: StoredDoc;
  /** BM25 score (higher = more relevant). */
  score: number;
  /** Short excerpt of the body around the first keyword hit. */
  snippet: string;
};

/**
 * Loads every doc from the global docs folder, ranks them with BM25 against
 * the query, and returns the best matches with a short snippet each.
 *
 * This is the function the future "find docs before answering" agent tool
 * will call to pull relevant context into the prompt.
 */
export async function searchDocs(
  query: string,
  limit = 5,
): Promise<DocSearchResult[]> {
  const docs = await readAllDocs();
  if (docs.length === 0) {
    return [];
  }

  const index = new Bm25Index();
  for (const doc of docs) {
    index.addDocument(doc.file, docToSearchText(doc));
  }

  return index.search(query, limit).map(({ id, score }) => {
    const doc = docs.find((candidate) => candidate.file === id)!;

    return { doc, score, snippet: buildSnippet(doc, query) };
  });
}

/** Lists all docs (name, description, keywords) without searching. */
export async function listDocs(): Promise<StoredDoc[]> {
  return readAllDocs();
}

function buildSnippet(doc: StoredDoc, query: string, radius = 120): string {
  const queryTokens = tokenize(query);
  const lowerBody = doc.body.toLowerCase();

  let hitIndex = -1;
  for (const token of queryTokens) {
    const position = lowerBody.indexOf(token);
    if (position !== -1) {
      hitIndex = position;
      break;
    }
  }

  if (hitIndex === -1) {
    return doc.body.slice(0, radius * 2).trim();
  }

  const start = Math.max(0, hitIndex - radius);
  const end = Math.min(doc.body.length, hitIndex + radius);

  return `${start > 0 ? "…" : ""}${doc.body.slice(start, end).trim()}${
    end < doc.body.length ? "…" : ""
  }`;
}
