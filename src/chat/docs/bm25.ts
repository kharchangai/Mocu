/**
 * Minimal, dependency-free BM25 (Okapi) ranking over tokenized documents.
 *
 * BM25 score for query term t in document d:
 *
 *   idf(t) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * |d| / avgdl))
 */

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;

/** Very small English stopword list; keeps the index tokens meaningful. */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "i", "in", "is", "it", "its", "of", "on", "or", "that", "the",
  "this", "to", "was", "were", "will", "with",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u0600-\u06FF]+/) // words, digits, Persian/Arabic letters
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export type Bm25Document = {
  id: string;
  tokens: string[];
};

export class Bm25Index {
  private readonly documents: Bm25Document[] = [];
  private readonly termFrequencies = new Map<string, Map<string, number>>();
  private readonly documentFrequencies = new Map<string, number>();
  private readonly documentLengths = new Map<string, number>();
  private totalLength = 0;

  constructor(
    private readonly k1: number = DEFAULT_K1,
    private readonly b: number = DEFAULT_B,
  ) {}

  addDocument(id: string, text: string): void {
    const tokens = tokenize(text);

    this.documents.push({ id, tokens });

    const frequencies = new Map<string, number>();
    for (const token of tokens) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }

    this.termFrequencies.set(id, frequencies);

    for (const token of frequencies.keys()) {
      this.documentFrequencies.set(
        token,
        (this.documentFrequencies.get(token) ?? 0) + 1,
      );
    }

    this.documentLengths.set(id, tokens.length);
    this.totalLength += tokens.length;
  }

  /** Ranked ids (best first) for a free-text query. */
  search(query: string, limit = 5): Array<{ id: string; score: number }> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.documents.length === 0) {
      return [];
    }

    const averageLength =
      this.documents.length > 0
        ? this.totalLength / this.documents.length
        : 1;

    const scores = new Map<string, number>();

    for (const token of new Set(queryTokens)) {
      const documentFrequency = this.documentFrequencies.get(token) ?? 0;
      if (documentFrequency === 0) {
        continue;
      }

      // Standard BM25 idf with a small floor to avoid negative scores.
      const idf = Math.log(
        1 +
          (this.documents.length - documentFrequency + 0.5) /
            (documentFrequency + 0.5),
      );

      for (const document of this.documents) {
        const frequency =
          this.termFrequencies.get(document.id)?.get(token) ?? 0;
        if (frequency === 0) {
          continue;
        }

        const length = this.documentLengths.get(document.id) ?? 0;
        const normalization =
          this.k1 * (1 - this.b + this.b * (length / averageLength));

        const score =
          idf *
          ((frequency * (this.k1 + 1)) / (frequency + normalization));

        scores.set(document.id, (scores.get(document.id) ?? 0) + score);
      }
    }

    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
