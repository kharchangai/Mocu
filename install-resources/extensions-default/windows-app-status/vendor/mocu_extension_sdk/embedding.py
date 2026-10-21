from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol


class EmbeddingApi:
    """
    Lets an extension create embedding vectors with Mocu's configured
    embedding model (whatever provider/API key the user set up in Mocu).
    """

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def embed(self, texts: list[str]) -> dict[str, Any]:
        if not isinstance(texts, list) or not texts:
            raise ValueError(
                "Embedding embed requires a non-empty 'texts' array."
            )

        for index, text in enumerate(texts):
            if not isinstance(text, str) or not text.strip():
                raise ValueError(
                    f"Embedding texts[{index}] must be a non-empty string."
                )

        return self._protocol.request(
            "mocu.embedding.embed",
            {"texts": texts},
        )

    def embed_text(self, text: str) -> list[float]:
        """Convenience wrapper: embed a single text and return its vector."""
        result = self.embed([text])
        embeddings = result.get("embeddings")

        if not isinstance(embeddings, list) or not embeddings:
            raise ValueError(
                "Embedding provider did not return an embedding vector."
            )

        return embeddings[0]
