import { readSettings } from "../../store";
import { Bm25Index, tokenize } from "./bm25";
import { ensureDocsIndex } from "./doc-index";
import { evaluateDocsJevRelevance } from "./docs-jev";
import type { JevEvaluationSource } from "./docs-jev";
import { ensureDocsIndexSchema, getDocsMeta } from "./docs-index-db";
import type {
  DocsRetrievalConfig,
  SearchDocsOptions,
} from "./docs-retrieval-config";
import {
  resolveDocsRetrievalConfig,
  resolveEffectiveCap,
} from "./docs-retrieval-config";
import { readAllDocs, readDoc } from "./doc-storage";
import type { StoredDoc } from "./doc-storage";

/**
 * Hybrid docs retrieval over the global SQLite index.
 *
 * One search = one bounded pipeline (never a full in-memory index rebuild):
 *
 *   1. Candidate generation (bounded by `candidateDepth` per query):
 *        - FTS5 BM25 candidates:  `docs_fts MATCH … ORDER BY bm25 LIMIT N`
 *        - Keyword candidates:    `docs_index … LIKE … LIMIT N`
 *      The union is at most 2 × candidateDepth rows.
 *   2. Query embedding: the query is embedded with the configured model and
 *      compared (cosine) against the stored vectors of the candidates whose
 *      `embedding_model` matches that same model.
 *   3. Each available signal is normalized to [0,1] (rules below), combined
 *      with the validated configurable weights into a deterministic hybrid
 *      score.
 *   4. OPTIONAL Jev relevance stage (config.jev.enabled): the top
 *      `jev.candidateLimit` candidates of the hybrid ranking are evaluated
 *      in ONE bounded `getJevDecision` call (compact id/title/description
 *      state only, explicit short timeout + abort signal, never one call per
 *      document or section). Valid probabilities in [0,1] GATE and REFINE
 *      the hybrid score:
 *          final = (1 - jevWeight) * hybrid + jevWeight * probability
 *      and BOTH values are retained (`score` = final, `jev.hybridScore` =
 *      hybrid). On missing key / timeout / malformed response the stage
 *      deterministically falls back: every candidate keeps its hybrid score
 *      (probability null), so nothing below the threshold is promoted.
 *   5. The relevance threshold filters on the FINAL score first, then the
 *      effective cap (= min(caller limit, configured docsResultCap))
 *      truncates the surviving ranked list. Only then are rows hydrated
 *      from their safe global file paths.
 *
 * Signal normalization (documented):
 *   - BM25: FTS5 returns negative scores (more negative = better); they are
 *     negated so higher = better, then min–max normalized over the candidates
 *     that FTS ranked. Empty signal (no FTS hits) → the signal is dropped and
 *     its weight is re-normalized onto the remaining signals. All raw values
 *     equal → every ranked candidate gets 1.0 when the common value is > 0
 *     (matched, but cannot discriminate) else 0.0.
 *   - Keyword: raw = number of unique query tokens found word-wise in the
 *     doc's metadata (title/description/keywords); normalized =
 *     raw / uniqueQueryTokens, already in [0,1] (absolute, not min–max).
 *   - Embedding: raw = cosine similarity in [-1,1]; normalized = clamp to
 *     [0,1] (negative similarity counts as 0). Unavailable when no candidate
 *     carries a vector from the currently configured model or the query
 *     embedding fails.
 *
 * Combination:
 *   - A signal unavailable for the whole query is excluded and the remaining
 *     weights are re-normalized (divided by their sum).
 *   - A candidate missing a value inside an available signal contributes 0
 *     for that component (its raw value stays null for diagnostics).
 *   - If no active signal carries weight, every combined score is 0.
 *
 * Threshold and cap are independent: the threshold filters on the final
 * (possibly Jev-refined) score first, then the effective cap truncates the
 * surviving ranked list. Ties break deterministically by path, then id,
 * ascending (code-unit order).
 *
 * Fallback: when the SQLite index cannot be opened at all, retrieval
 * degrades to the lexical in-memory BM25 + keyword path over `readAllDocs`
 * with the same normalization/Jev/threshold/cap rules (no embeddings).
 */

/** Cap on query tokens sent into one SQL keyword LIKE clause. */
const MAX_SQL_KEYWORD_TOKENS = 12;
/** Cap on query tokens sent into one FTS5 MATCH expression. */
const MAX_FTS_TOKENS = 16;

/** Normalized component scores; null = signal unavailable for this query. */
export type DocSearchScores = {
  bm25: number | null;
  keyword: number | null;
  embedding: number | null;
};

/**
 * Jev relevance stage outcome attached to every result. `hybridScore` is
 * always the deterministic BM25/keyword/embedding combination; `score` on
 * the result is the final (refined when applied) value the threshold and
 * cap operate on. Both values are retained whenever Jev refines a score.
 */
export type DocSearchJevInfo = {
  /** True only when a valid Jev probability was applied. */
  applied: boolean;
  /** Jev probability in [0,1]; null when unavailable/invalid. */
  probability: number | null;
  /** Configured refinement weight used for this search. */
  weight: number;
  /** Why the probability is null ("jev" when applied; null = n/a). */
  source: JevEvaluationSource;
  /** The deterministic hybrid score before any Jev refinement. */
  hybridScore: number;
};

export type DocSearchResult = {
  doc: StoredDoc;
  /** Final score in [0,1] (Jev-refined when applied); threshold+cap use it. */
  score: number;
  /** Jev stage outcome (probability, source, and the pre-refinement score). */
  jev: DocSearchJevInfo;
  /** Normalized components that entered the hybrid score (null = unavailable). */
  scores: DocSearchScores;
  /** Pre-normalization values, oriented higher = better (null = no value). */
  raw: DocSearchScores;
  /** Short excerpt of the body around the first keyword hit. */
  snippet: string;
};

/** One candidate row of the bounded retrieval stage. */
type Candidate = {
  id: string;
  /** Canonical relative path (file name inside the global docs folder). */
  path: string;
  title: string;
  description: string;
  keywords: string[];
  searchText: string;
  embedding: number[] | null;
  embeddingModel: string | null;
  /** FTS5 bm25 negated so higher = better; null when FTS did not rank it. */
  bm25Raw: number | null;
};

type RawCandidateRow = {
  id: string;
  path: string;
  title: string;
  description: string;
  keywords: string;
  search_text: string;
  embedding: string | null;
  embedding_model: string | null;
};

type ScoredCandidate = {
  candidate: Candidate;
  /** Deterministic hybrid score (pre-Jev). */
  hybridScore: number;
  /** Final Jev evaluation, attached by refineScoredCandidates before the
   *  threshold stage; null only transiently before that step. */
  jev: DocSearchJevInfo | null;
  /** Final score used for threshold + cap (=== hybridScore when Jev off). */
  score: number;
  scores: DocSearchScores;
  raw: DocSearchScores;
};
type DocsDatabase = Awaited<ReturnType<typeof ensureDocsIndexSchema>>;

let lastWarnedSearchContext = "";

function warnSearch(context: string, error: unknown): void {
  // One warning per distinct context so a broken database/provider cannot
  // flood the log once per query.
  if (context === lastWarnedSearchContext) {
    return;
  }
  lastWarnedSearchContext = context;
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[Docs Search] ${context}: ${detail}`);
}

/* -------------------------------------------------------------------------- */
/* Pure helpers (exported for tests/diagnostics)                              */
/* -------------------------------------------------------------------------- */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Min–max normalizes raw scores to [0,1] (higher raw → higher result).
 *
 * Documented edge handling:
 *   - empty input → empty map (signal unavailable)
 *   - all values equal → 1.0 each when the common value is > 0 (the signal
 *     matched but cannot discriminate), otherwise 0.0 (no positive evidence)
 */
export function minMaxNormalize(
  values: ReadonlyMap<string, number>,
): Map<string, number> {
  const normalized = new Map<string, number>();
  if (values.size === 0) {
    return normalized;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of values.values()) {
    if (!Number.isFinite(value)) {
      continue;
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return normalized;
  }

  if (max === min) {
    const common = max;
    for (const id of values.keys()) {
      normalized.set(id, common > 0 ? 1 : 0);
    }
    return normalized;
  }

  const range = max - min;
  for (const [id, value] of values) {
    normalized.set(id, Number.isFinite(value) ? (value - min) / range : 0);
  }
  return normalized;
}

/**
 * Cosine similarity in [-1,1]. Null when either vector is empty, the
 * lengths differ, or either has a zero norm (undefined direction).
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number | null {
  if (a.length === 0 || a.length !== b.length) {
    return null;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA <= 0 || normB <= 0) {
    return null;
  }

  const value = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(value) ? value : null;
}

/**
 * Keyword signal raw value: how many unique query tokens appear word-wise
 * in the document's metadata text (title/description/keywords).
 * Normalized score = count / uniqueQueryTokens (already in [0,1]).
 */
export function countKeywordMatches(
  queryTokens: readonly string[],
  metadataText: string,
): number {
  const uniqueTokens = new Set(queryTokens);
  if (uniqueTokens.size === 0) {
    return 0;
  }

  const docTokens = new Set(tokenize(metadataText));
  let matched = 0;
  for (const token of uniqueTokens) {
    if (docTokens.has(token)) {
      matched += 1;
    }
  }
  return matched;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Searches the saved docs with the hybrid SQLite pipeline (BM25 + keyword +
 * embedding), applies the configured relevance threshold, then returns at
 * most the configured (or caller-requested) number of hydrated docs.
 *
 * `options` may be a number (shorthand for `{ limit }`, kept for backward
 * compatibility) or a full options object with test/diagnostic overrides.
 */
export async function searchDocs(
  query: string,
  options: number | SearchDocsOptions = {},
): Promise<DocSearchResult[]> {
  const opts: SearchDocsOptions =
    typeof options === "number" ? { limit: options } : options ?? {};

  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const queryTokens = tokenize(trimmed);
  if (queryTokens.length === 0) {
    // No lexical tokens → no bounded candidates can be generated.
    return [];
  }

  const settings = await loadSettingsSafe();
  const config = resolveDocsRetrievalConfig(settings, opts);
  const cap = resolveEffectiveCap(config, opts.limit);
  const depth = Math.max(config.candidateDepth, cap);

  let candidates: Candidate[] | null = null;
  try {
    await ensureDocsIndex();
    candidates = await fetchSqlCandidates(queryTokens, depth);
  } catch (error) {
    candidates = null;
    warnSearch("SQLite retrieval unavailable, using lexical fallback", error);
  }

  if (candidates === null) {
    return lexicalFallbackSearch(trimmed, queryTokens, config, cap);
  }

  if (candidates.length === 0) {
    return [];
  }

  const embeddingModel = (settings?.embeddingModel ?? "").trim();
  const queryVector = await embedQuery(trimmed, embeddingModel, candidates);

  const scored = scoreCandidates(
    queryTokens,
    candidates,
    config,
    queryVector,
    embeddingModel,
  );

  // Stage 4: ONE bounded Jev call over the top candidates (deterministic
  // fallback when disabled or failing — see docs-jev.ts contract), then
  // re-rank by the final score for threshold/cap/output ordering.
  await refineScoredCandidates(scored, trimmed, config);
  sortScoredCandidates(scored);

  // Stage 5a: relevance threshold on the FINAL (possibly refined) score.
  const passing = scored.filter(
    (entry) => entry.score >= config.relevanceThreshold,
  );

  // Stage 5b: the effective cap truncates the surviving ranked list — a
  // distinct control from the threshold above.
  const results: DocSearchResult[] = [];
  for (const entry of passing) {
    if (results.length >= cap) {
      break;
    }
    // Hydration uses the safe global path (readDoc strips traversal).
    const doc = await readDoc(entry.candidate.path);
    if (!doc) {
      // File vanished since indexing: skip and try the next candidate.
      continue;
    }
    results.push({
      doc,
      score: entry.score,
      jev: toJevInfo(entry),
      scores: entry.scores,
      raw: entry.raw,
      snippet: buildSnippet(doc, trimmed),
    });
  }

  return results;
}

/**
 * Runs the bounded Jev relevance stage over a hybrid-ranked candidate list
 * (exactly ONE `getJevDecision` call when enabled) and mutates each entry's
 * `score`/`jev` fields in place. The deterministic `hybridScore` is always
 * retained on the entry.
 */
async function refineScoredCandidates(
  scored: ScoredCandidate[],
  query: string,
  config: DocsRetrievalConfig,
): Promise<void> {
  const summaries = scored.map((entry) => ({
    id: entry.candidate.id,
    title: entry.candidate.title,
    description: entry.candidate.description,
  }));
  const hybridScores = new Map(
    scored.map((entry) => [entry.candidate.id, entry.score]),
  );

  const evaluations = await evaluateDocsJevRelevance({
    query,
    candidates: summaries,
    hybridScores,
    config,
  });

  for (const entry of scored) {
    const evaluation = evaluations.get(entry.candidate.id);
    if (!evaluation) {
      // Outside the bounded top-N: never sent to Jev, keeps its hybrid score.
      entry.hybridScore = entry.score;
      entry.jev = {
        applied: false,
        probability: null,
        weight: config.jev.weight,
        source: "not-evaluated",
        hybridScore: entry.score,
      };
      continue;
    }
    entry.hybridScore = evaluation.hybridScore;
    entry.score = evaluation.finalScore;
    entry.jev = {
      applied: evaluation.source === "jev",
      probability: evaluation.probability,
      weight: config.jev.weight,
      source: evaluation.source,
      hybridScore: evaluation.hybridScore,
    };
  }
}

function toJevInfo(entry: ScoredCandidate): DocSearchJevInfo {
  if (entry.jev) {
    return entry.jev;
  }
  return {
    applied: false,
    probability: null,
    weight: 0,
    source: "disabled",
    hybridScore: entry.hybridScore,
  };
}

/** Lists all docs (title, description, keywords) without searching. */
export async function listDocs(): Promise<StoredDoc[]> {
  return readAllDocs();
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

async function loadSettingsSafe(): Promise<
  Awaited<ReturnType<typeof readSettings>> | null
> {
  try {
    return await readSettings();
  } catch (error) {
    warnSearch("settings unavailable, using default retrieval config", error);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Candidate generation (bounded SQL)                                         */
/* -------------------------------------------------------------------------- */

async function fetchSqlCandidates(
  queryTokens: string[],
  depth: number,
): Promise<Candidate[]> {
  const database = await ensureDocsIndexSchema();

  // 1) Keyword candidates: bounded LIKE scan over the catalog.
  const keywordTokens = queryTokens.slice(0, MAX_SQL_KEYWORD_TOKENS);
  const keywordRows = await fetchKeywordCandidates(
    database,
    keywordTokens,
    depth,
  );

  const byId = new Map<string, Candidate>();
  for (const row of keywordRows) {
    byId.set(String(row.id), toCandidate(row, null));
  }

  // 2) FTS5 BM25 candidates: bounded, best-first.
  const ftsTokens = queryTokens.slice(0, MAX_FTS_TOKENS);
  if (ftsTokens.length > 0 && (await getDocsMeta("fts_enabled")) === "1") {
    try {
      const hits = await fetchFtsCandidates(database, ftsTokens, depth);

      const missingIds = hits
        .map((hit) => hit.id)
        .filter((id) => !byId.has(id));
      if (missingIds.length > 0) {
        const extraRows = await fetchRowsByIds(database, missingIds);
        for (const row of extraRows) {
          byId.set(String(row.id), toCandidate(row, null));
        }
      }

      for (const hit of hits) {
        const candidate = byId.get(hit.id);
        if (candidate) {
          candidate.bm25Raw = hit.raw;
        }
      }
    } catch (error) {
      // FTS unusable right now (e.g. fts_enabled flipped): keyword
      // candidates + embeddings still provide retrieval.
      warnSearch("FTS BM25 candidates unavailable", error);
    }
  }

  return Array.from(byId.values());
}

function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, "\\$&");
}

async function fetchKeywordCandidates(
  database: DocsDatabase,
  tokens: string[],
  limit: number,
): Promise<RawCandidateRow[]> {
  if (tokens.length === 0) {
    return [];
  }

  const fields = ["title", "description", "keywords", "search_text"];
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  for (const token of tokens) {
    const pattern = `%${escapeLike(token)}%`;
    for (const field of fields) {
      conditions.push(`${field} LIKE ? ESCAPE '\\'`);
      params.push(pattern);
    }
  }
  params.push(limit);

  const rows = await database.select<RawCandidateRow[]>(
    `SELECT id, path, title, description, keywords, search_text,
            embedding, embedding_model
     FROM docs_index
     WHERE ${conditions.join(" OR ")}
     LIMIT ?`,
    params,
  );
  return rows ?? [];
}

async function fetchFtsCandidates(
  database: DocsDatabase,
  tokens: string[],
  limit: number,
): Promise<Array<{ id: string; raw: number }>> {
  const matchExpr = tokens.map((token) => `"${token}"`).join(" OR ");

  const rows = await database.select<Array<{ id: string; bm25_raw: number }>>(
    `SELECT d.id AS id, bm25(docs_fts) AS bm25_raw
     FROM docs_fts
     JOIN docs_index d ON d.rowid = docs_fts.rowid
     WHERE docs_fts MATCH ?
     ORDER BY bm25_raw ASC
     LIMIT ?`,
    [matchExpr, limit],
  );

  // FTS5 bm25() is negative (more negative = better): negate so higher = better.
  return (rows ?? []).map((row) => ({
    id: String(row.id),
    raw: -Number(row.bm25_raw),
  }));
}

async function fetchRowsByIds(
  database: DocsDatabase,
  ids: string[],
): Promise<RawCandidateRow[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await database.select<RawCandidateRow[]>(
    `SELECT id, path, title, description, keywords, search_text,
            embedding, embedding_model
     FROM docs_index
     WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return rows ?? [];
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is string => typeof entry === "string",
      );
    }
  } catch {
    // fall through
  }
  return [];
}

function parseJsonVector(value: unknown): number[] | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(Number);
    }
  } catch {
    // fall through
  }
  return null;
}

function toCandidate(row: RawCandidateRow, bm25Raw: number | null): Candidate {
  return {
    id: String(row.id),
    path: String(row.path),
    title: String(row.title ?? ""),
    description: String(row.description ?? ""),
    keywords: parseJsonStringArray(row.keywords),
    searchText: String(row.search_text ?? ""),
    embedding: parseJsonVector(row.embedding),
    embeddingModel:
      row.embedding_model == null ? null : String(row.embedding_model),
    bm25Raw,
  };
}

/* -------------------------------------------------------------------------- */
/* Query embedding                                                            */
/* -------------------------------------------------------------------------- */

async function embedQuery(
  query: string,
  model: string,
  candidates: Candidate[],
): Promise<number[] | null> {
  if (model === "") {
    return null;
  }

  const hasMatchingVector = candidates.some(
    (candidate) =>
      candidate.embedding !== null && candidate.embeddingModel === model,
  );
  if (!hasMatchingVector) {
    // Vectors from another model live in a different space; comparing
    // against them would be noise.
    return null;
  }

  try {
    // Dynamic import keeps the heavy langchain provider out of the module
    // graph until a search actually needs an embedding.
    const { textSimilarity } = await import(
      "../../services/ai/tools/textSimilarity"
    );
    return await textSimilarity.embedText(query);
  } catch (error) {
    warnSearch("query embedding failed, continuing without it", error);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

function scoreCandidates(
  queryTokens: string[],
  candidates: Candidate[],
  config: DocsRetrievalConfig,
  queryVector: number[] | null,
  embeddingModel: string,
): ScoredCandidate[] {
  const uniqueTokenCount = new Set(queryTokens).size;

  // --- BM25 signal (min-max over candidates FTS ranked) ---
  const bm25RawById = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.bm25Raw !== null && Number.isFinite(candidate.bm25Raw)) {
      bm25RawById.set(candidate.id, candidate.bm25Raw);
    }
  }
  const bm25Norm = minMaxNormalize(bm25RawById);
  const bm25Available = bm25Norm.size > 0;

  // --- Keyword signal (absolute: matched / unique query tokens) ---
  const keywordRawById = new Map<string, number>();
  for (const candidate of candidates) {
    const metadataText = [
      candidate.title,
      candidate.description,
      candidate.keywords.join(" "),
    ]
      .filter((part) => part.trim().length > 0)
      .join("\n");
    keywordRawById.set(
      candidate.id,
      countKeywordMatches(queryTokens, metadataText),
    );
  }
  const keywordAvailable = uniqueTokenCount > 0;

  // --- Embedding signal (clamped cosine vs the query vector) ---
  const embeddingNormById = new Map<string, number>();
  if (queryVector !== null) {
    for (const candidate of candidates) {
      if (
        candidate.embedding === null ||
        candidate.embeddingModel !== embeddingModel
      ) {
        continue;
      }
      const cosine = cosineSimilarity(queryVector, candidate.embedding);
      if (cosine === null) {
        continue;
      }
      embeddingNormById.set(candidate.id, clamp01(cosine));
    }
  }
  const embeddingAvailable = embeddingNormById.size > 0;

  // Signals unavailable for the whole query drop out; their weight is
  // re-normalized onto the remaining signals.
  const activeWeights = {
    bm25: bm25Available ? config.weights.bm25 : 0,
    keyword: keywordAvailable ? config.weights.keyword : 0,
    embedding: embeddingAvailable ? config.weights.embedding : 0,
  };
  const totalWeight =
    activeWeights.bm25 + activeWeights.keyword + activeWeights.embedding;

  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    const keywordRaw = keywordRawById.get(candidate.id) ?? 0;
    const keywordNorm =
      uniqueTokenCount > 0 ? clamp01(keywordRaw / uniqueTokenCount) : 0;

    const bm25Value = bm25Available ? (bm25Norm.get(candidate.id) ?? 0) : 0;
    const embeddingValue = embeddingAvailable
      ? (embeddingNormById.get(candidate.id) ?? 0)
      : 0;

    const combined =
      totalWeight > 0
        ? (activeWeights.bm25 * bm25Value +
            activeWeights.keyword * keywordNorm +
            activeWeights.embedding * embeddingValue) /
          totalWeight
        : 0;

    const cosine =
      queryVector !== null &&
      candidate.embedding !== null &&
      candidate.embeddingModel === embeddingModel
        ? cosineSimilarity(queryVector, candidate.embedding)
        : null;

    return {
      candidate,
      hybridScore: clamp01(combined),
      score: clamp01(combined),
      jev: null,
      scores: {
        bm25: bm25Available ? bm25Value : null,
        keyword: keywordAvailable ? keywordNorm : null,
        embedding: embeddingAvailable ? embeddingValue : null,
      },
      raw: {
        bm25: candidate.bm25Raw,
        keyword: keywordRaw,
        embedding: cosine,
      },
    };
  });

  // Deterministic tie order: score desc, then path asc, then id asc.
  sortScoredCandidates(scored);

  return scored;
}

/** Deterministic ordering: score desc, then path asc, then id asc. */
function sortScoredCandidates(scored: ScoredCandidate[]): void {
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      compareStrings(a.candidate.path, b.candidate.path) ||
      compareStrings(a.candidate.id, b.candidate.id),
  );
}


function compareStrings(a: string, b: string): number {
  // Code-unit order (locale-independent → deterministic across machines).
  return a < b ? -1 : a > b ? 1 : 0;
}

/* -------------------------------------------------------------------------- */
/* Lexical fallback (SQLite unavailable)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Lexical-only search used when the SQLite index cannot be opened: builds a
 * bounded candidate list from in-memory BM25 + keyword matches over
 * `readAllDocs`, then applies the same normalization/threshold/cap rules.
 * Never used on the normal path.
 */
async function lexicalFallbackSearch(
  query: string,
  queryTokens: string[],
  config: DocsRetrievalConfig,
  cap: number,
): Promise<DocSearchResult[]> {
  const docs = await readAllDocs();
  if (docs.length === 0) {
    return [];
  }

  const index = new Bm25Index();
  for (const doc of docs) {
    index.addDocument(doc.file, docToSearchText(doc));
  }
  const ranked = index.search(query, docs.length);
  const bm25ById = new Map(ranked.map((entry) => [entry.id, entry.score]));

  const candidates: Candidate[] = [];
  for (const doc of docs) {
    const metadataText = [doc.title, doc.description, doc.keywords.join(" ")]
      .filter((part) => part.trim().length > 0)
      .join("\n");
    const keywordRaw = countKeywordMatches(queryTokens, metadataText);
    const bm25Raw = bm25ById.get(doc.file) ?? null;

    if (bm25Raw === null && keywordRaw === 0) {
      continue; // no lexical evidence at all
    }

    candidates.push({
      id: doc.id,
      path: doc.file,
      title: doc.title,
      description: doc.description,
      keywords: doc.keywords,
      searchText: docToSearchText(doc),
      embedding: null,
      embeddingModel: null,
      bm25Raw,
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  const scored = scoreCandidates(queryTokens, candidates, config, null, "");

  // Same bounded Jev stage as the SQL path (ONE call, deterministic
  // fallback) — then the same threshold → cap → hydration sequence.
  await refineScoredCandidates(scored, query, config);
  sortScoredCandidates(scored);

  const docsByPath = new Map(docs.map((doc) => [doc.file, doc]));

  const results: DocSearchResult[] = [];
  for (const entry of scored) {
    if (entry.score < config.relevanceThreshold) {
      continue;
    }
    if (results.length >= cap) {
      break;
    }
    const doc = docsByPath.get(entry.candidate.path);
    if (!doc) {
      continue;
    }
    results.push({
      doc,
      score: entry.score,
      jev: toJevInfo(entry),
      scores: entry.scores,
      raw: entry.raw,
      snippet: buildSnippet(doc, query),
    });
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* Snippets                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Searchable representation of one doc for BM25. Title and keywords are
 * repeated so exact keyword hits outrank body mentions.
 */
function docToSearchText(doc: StoredDoc): string {
  return [
    doc.title,
    doc.title,
    doc.keywords.join(" "),
    doc.keywords.join(" "),
    doc.keywords.join(" "),
    doc.description,
    doc.body,
  ].join("\n");
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
