from __future__ import annotations

from typing import Any

from .agents import AgentsApi
from .decision import DecisionApi
from .embedding import EmbeddingApi
from .llm import LlmApi
from .protocol import JsonRpcProtocol
from .types import CommandHandler
from .ui import ExtensionUiApi


class MocuExtension:
    """
    Minimal Mocu extension. Extensions can call Mocu's host AI APIs, interact
    with the user in chat, and invoke saved user agents through the host; they
    do not need to bundle a language model for these features.
    """

    def __init__(self) -> None:
        self._protocol = JsonRpcProtocol()
        self._commands: dict[str, CommandHandler] = {}

        # Host-managed AI APIs and saved user-agent invocation.
        self.llm = LlmApi(self._protocol)
        self.decision = DecisionApi(self._protocol)
        self.embedding = EmbeddingApi(self._protocol)
        self.agents = AgentsApi(self._protocol)
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
            context = {
                **context,
                "mocu": {
                    "ui": ExtensionUiApi(
                        self._protocol,
                        command,
                        {
                            key: value
                            for key, value in context.items()
                            if key != "mocu"
                        },
                    ),
                },
            }
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
