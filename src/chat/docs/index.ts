/**
 * Mocu docs: LLM-generated searchable knowledge documents.
 *
 * Flow:
 *   1. `createDocFromText(text)` — the user gives raw text, an LLM turns it
 *      into a complete markdown document with frontmatter
 *      (name / description / keywords) and it is saved in the GLOBAL mocu
 *      docs folder: BaseDirectory.AppData/docs.
 *   2. `searchDocs(query)` — BM25 + keyword search over the saved docs.
 *      Intended to be wrapped in an agent tool later, so that before the
 *      agent answers, it can find the docs matching what the user asked.
 */
export {
  createDocFromText,
  updateDocFromText,
  updateDocFields,
} from "./doc-generator";
export type {
  CreatedDoc,
  CreateDocOptions,
  UpdateDocOptions,
  DocFieldUpdates,
} from "./doc-generator";

export { searchDocs, listDocs } from "./doc-search";
export type { DocSearchResult } from "./doc-search";

export {
  findRelevantSection,
  findRelevantSectionsForDocs,
  splitDocIntoSections,
} from "./doc-section-finder";
export type {
  DocSection,
  SectionRelevance,
  RelevantSectionResult,
} from "./doc-section-finder";

export { buildDocsContextPrompt } from "./docs-context";

export {
  saveDoc,
  writeDocFile,
  readDoc,
  deleteDoc,
  readAllDocs,
  DOCS_DIRECTORY,
} from "./doc-storage";
export type { StoredDoc } from "./doc-storage";

export {
  parseDoc,
  serializeDoc,
  docNameToSlug,
} from "./doc-frontmatter";
export type { DocFrontmatter, ParsedDoc } from "./doc-frontmatter";

export { Bm25Index, tokenize } from "./bm25";
