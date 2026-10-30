from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol
from .extract_typed_fields import TypedFieldsApi


class ExtractApi:
    """Extracts named entities through Mocu's configured Extract model."""

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol
        self.typed_fields = TypedFieldsApi(protocol)

    def entities(
        self,
        text: str,
        entities: dict[str, str],
        *,
        threshold: float | None = None,
        top_n: int | None = None,
    ) -> dict[str, Any]:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Extract entities requires a non-empty text string.")
        if not isinstance(entities, dict) or not entities:
            raise ValueError("Extract entities requires at least one entity description.")

        params: dict[str, Any] = {"text": text.strip(), "entities": entities}
        if threshold is not None:
            params["threshold"] = threshold
        if top_n is not None:
            params["top_n"] = top_n
        return self._protocol.request("mocu.extract.entities", params)
