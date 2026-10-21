from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol

MAX_TTS_TEXT_LENGTH = 20_000
MAX_STT_AUDIO_BASE64_LENGTH = 40_000_000


class SpeechApi:
    """
    Lets an extension transcribe audio to text (STT) and synthesize text to
    speech (TTS) with the models the user configured in Mocu Settings
    (gateway, API key, models, and voice) - no separate API key needed.
    """

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def transcribe(self, audio: str, mime_type: str | None = None) -> dict[str, Any]:
        """Transcribe base64-encoded audio into text."""
        if not isinstance(audio, str) or not audio.strip():
            raise ValueError(
                "Speech transcribe requires a non-empty base64 'audio' string."
            )

        if len(audio) > MAX_STT_AUDIO_BASE64_LENGTH:
            raise ValueError(
                "Speech transcribe audio is too large "
                f"(maximum {MAX_STT_AUDIO_BASE64_LENGTH} base64 characters)."
            )

        params: dict[str, Any] = {"audio": audio}

        if mime_type:
            params["mimeType"] = mime_type

        return self._protocol.request("mocu.stt.transcribe", params)

    def speak(self, text: str) -> dict[str, Any]:
        """Synthesize text into base64-encoded speech audio."""
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Speech speak requires a non-empty 'text' string.")

        if len(text) > MAX_TTS_TEXT_LENGTH:
            raise ValueError(
                "Speech speak text is too long "
                f"(maximum {MAX_TTS_TEXT_LENGTH} characters per call)."
            )

        return self._protocol.request("mocu.tts.speak", {"text": text})