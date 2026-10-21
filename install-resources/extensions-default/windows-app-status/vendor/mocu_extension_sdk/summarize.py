from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol


class SummarizeApi:
    """Summarizes text through Mocu's separately configured Summarize model."""

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def text(
        self,
        text: str,
        *,
        instructions: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Summarize text requires a non-empty text string.")

        params: dict[str, Any] = {"text": text.strip()}
        if instructions is not None:
            params["instructions"] = instructions

        return self._protocol.request("mocu.summarize.text", params)
