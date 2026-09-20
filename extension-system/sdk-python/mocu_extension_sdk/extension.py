from __future__ import annotations

from typing import Any

from .decision import DecisionApi
from .embedding import EmbeddingApi
from .llm import LlmApi
from .protocol import JsonRpcProtocol
from .types import CommandHandler


class MocuExtension:
    """
    Minimal Mocu extension. An extension registers command handlers and calls
    `run()`; Mocu invokes the requested command on demand via
    `extension.execute`. Extensions may also call host APIs from inside a
    command: `extension.llm.generate()`, `extension.decision.ask()` and
    `extension.embedding.embed()`. Handlers receive `(input, context, config)`
    where `config` holds the values the user filled in on the extension's
    card in the Extensions page (manifest `config` fields).
    """

    def __init__(self) -> None:
        self._protocol = JsonRpcProtocol()
        self._commands: dict[str, CommandHandler] = {}

        # Let extensions call the Mocu host LLM, Jev decision model and
        # embedding model.
        self.llm = LlmApi(self._protocol)
        self.decision = DecisionApi(self._protocol)
        self.embedding = EmbeddingApi(self._protocol)

        self._protocol.register_handler(
            "extension.execute",
            self._handle_execute,
        )

    def command(
        self,
        name: str,
    ):
        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError("Command name cannot be empty.")

        def decorator(handler: CommandHandler) -> CommandHandler:
            self.register_command(normalized_name, handler)
            return handler

        return decorator

    def register_command(self, name: str, handler: CommandHandler) -> None:
        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError("Command name cannot be empty.")

        if normalized_name in self._commands:
            raise ValueError(f"Command is already registered: {normalized_name}")

        self._commands[normalized_name] = handler

    def run(self) -> None:
        self._protocol.run()

    def _handle_execute(self, params: Any) -> dict[str, Any]:
        if not isinstance(params, dict):
            return {
                "success": False,
                "error": "Execute params must be an object.",
            }

        command = params.get("command")

        if not isinstance(command, str):
            return {
                "success": False,
                "error": "Command must be a string.",
            }

        handler = self._commands.get(command)

        if handler is None:
            return {
                "success": False,
                "error": f"Unknown command: {command}",
            }

        input_value = params.get("input")
        context = params.get("context", {})
        config = params.get("config", {})

        if not isinstance(context, dict):
            context = {}

        if not isinstance(config, dict):
            config = {}

        try:
            output = handler(input_value, context, config)

            return {
                "success": True,
                "output": output,
            }
        except Exception as error:
            return {
                "success": False,
                "error": str(error),
            }


def create_extension() -> MocuExtension:
    return MocuExtension()
