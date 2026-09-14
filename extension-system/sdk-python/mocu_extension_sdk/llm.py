from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol


class LlmApi:
    """
    Lets an extension call the Mocu host LLM from inside a command.
    """

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def generate(
        self,
        prompt: str,
        *,
        system_prompt: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ValueError("LLM generate requires a non-empty prompt string.")

        params: dict[str, Any] = {
            "prompt": prompt.strip(),
        }

        if system_prompt is not None:
            params["systemPrompt"] = system_prompt
        if temperature is not None:
            params["temperature"] = temperature
        if max_tokens is not None:
            params["maxTokens"] = max_tokens

        return self._protocol.request(
            "mocu.llm.generate",
            params,
        )
