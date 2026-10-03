/**
 * Mocu docs: LLM-generated searchable knowledge documents.
 *
 * Flow:
 *   1. `createDocFromText(text)` — the user gives raw text, an LLM turns it
 *      into a complete markdown document with frontmatter
 *      (id / title / description / keywords) and it is saved in the GLOBAL mocu
 *      docs folder: BaseDirectory.AppData/docs. Legacy docs that still use
 *      `name` frontmatter map `name` → `title` and get a deterministic id.
 *   2. `searchDocs(query)` — SQLite-backed hybrid retrieval: bounded FTS5
 *      BM25 + keyword candidates, cosine scoring against one stored
 *      embedding per doc, normalized configurable signal weights, an
 *      independent relevance threshold and result cap, plus the optional
 *      single bounded Jev refinement call. Falls back to lexical BM25
 *      when the index is unavailable.
 *      This is the ONLY active doc retriever: prompt references come from
 *      `buildDocsContextPrompt` (metadata only) and the agent reads full
 *      content on demand with the read_knowledge_doc tool.
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
export type {
  DocSearchResult,
  DocSearchScores,
  DocSearchJevInfo,
} from "./doc-search";
export {
  minMaxNormalize,
  cosineSimilarity,
  countKeywordMatches,
} from "./doc-search";

export {
  evaluateDocsJevRelevance,
  buildJevState,
  extractJevAnswer,
  refineHybridScore,
  truncateForJev,
  MAX_JEV_CANDIDATES,
  MAX_STATE_CHARS,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
} from "./docs-jev";
export type {
  JevCandidateSummary,
  JevCandidateEvaluation,
  JevEvaluationSource,
  EvaluateDocsJevOptions,
} from "./docs-jev";

export {
  resolveDocsRetrievalConfig,
  resolveEffectiveCap,
  validateUnitInterval,
  validateRangedInt,
  DOCS_RETRIEVAL_DEFAULTS,
  DOCS_RESULT_CAP_RANGE,
  DOCS_CANDIDATE_DEPTH_RANGE,
  DOCS_JEV_CANDIDATE_LIMIT_RANGE,
  DOCS_JEV_TIMEOUT_RANGE,
} from "./docs-retrieval-config";
export { buildDocsContextPrompt, escapeDocsMetadata, MAX_CONTEXT_DOCS, MAX_CONTEXT_TITLE_CHARS, MAX_CONTEXT_DESCRIPTION_CHARS, MAX_CONTEXT_KEYWORD_CHARS, MAX_CONTEXT_KEYWORDS } from "./docs-context";
export type { DocsContextOptions } from "./docs-context";

export {
  saveDoc,
  writeDocFile,
  readDoc,
  readDocOrReject,
  deleteDoc,
  readAllDocs,
  readAllDocsWithRaw,
  DOCS_DIRECTORY,
} from "./doc-storage";
export type { StoredDoc, StoredDocWithRaw } from "./doc-storage";

export {
  resolveDocReference,
  describeDocReferenceRejection,
  stripAnchor,
} from "./doc-link-resolver";
export type {
  ResolveDocReferenceResult,
  DocReferenceRejection,
} from "./doc-link-resolver";

export {
  ensureDocsIndex,
  reconcileDocsIndex,
  rebuildDocsIndex,
  syncDocIndexAfterWrite,
  removeDocFromIndex,
  sha256Hex,
} from "./doc-index";
export type { DocIndexRow, ReconcileReport } from "./doc-index";

export {
  docsIndexDatabaseUrl,
  getDocsMeta,
  DOCS_INDEX_DB_FILE,
  DOCS_INDEX_SCHEMA_VERSION,
} from "./docs-index-db";

export {
  parseDoc,
  serializeDoc,
  docNameToSlug,
  normalizeDocId,
} from "./doc-frontmatter";
export type {
  DocFrontmatter,
  ParsedDoc,
  ParseDocOptions,
} from "./doc-frontmatter";

/**
 * BM25/tokenize utilities. On the docs side the primary retrieval path is
 * the SQLite hybrid search in doc-search.ts; Bm25Index remains the lexical
 * fallback for it and is also used directly for note ranking.
 */
export { Bm25Index, tokenize } from "./bm25";