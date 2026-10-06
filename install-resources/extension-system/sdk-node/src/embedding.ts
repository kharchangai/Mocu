import type {
  EmbeddingEmbedParams,
  EmbeddingEmbedResult,
} from "@mocu/extension-contracts";

import { EMBEDDING_EMBED_METHOD } from "@mocu/extension-contracts";

import { JsonRpcProtocolClient } from "./protocol-client.js";

/**
 * Lets an extension create embedding vectors with Mocu's configured
 * embedding model (whatever provider/API key the user set up in Mocu).
 */
export class EmbeddingApi {
  constructor(private readonly client: JsonRpcProtocolClient) {}

  async embed(
    params: EmbeddingEmbedParams,
  ): Promise<EmbeddingEmbedResult> {
    if (
      !params ||
      !Array.isArray(params.texts) ||
      params.texts.length === 0
    ) {
      throw new Error(
        "Embedding embed requires a non-empty 'texts' array.",
      );
    }

    const texts = params.texts.map((text, index) => {
      if (typeof text !== "string" || !text.trim()) {
        throw new Error(
          `Embedding texts[${index}] must be a non-empty string.`,
        );
      }

      return text;
    });

    return this.client.request<EmbeddingEmbedResult>(
      EMBEDDING_EMBED_METHOD,
      { texts },
    );
  }

  /**
   * Convenience wrapper: embed a single text and return its vector.
   */
  async embedText(text: string): Promise<number[]> {
    const { embeddings } = await this.embed({ texts: [text] });

    const embedding = embeddings[0];

    if (!Array.isArray(embedding)) {
      throw new Error(
        "Embedding provider did not return an embedding vector.",
      );
    }

    return embedding;
  }
}

export default EmbeddingApi;
