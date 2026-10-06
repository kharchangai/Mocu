export const EMBEDDING_EMBED_METHOD = "mocu.embedding.embed" as const;

export interface EmbeddingEmbedParams {
  /** One or more texts to embed with Mocu's configured embedding model. */
  texts: string[];
}

export interface EmbeddingEmbedResult {
  /** One vector per input text, in the same order. */
  embeddings: number[][];
}
