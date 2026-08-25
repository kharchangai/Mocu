from __future__ import annotations

from typing import Any

from .llm import LlmApi
from .protocol import JsonRpcProtocol
from .types import CommandHandler


class MocuExtension:
    """
    Minimal Mocu extension. An extension registers command handlers and calls
    `run()`; Mocu invokes the requested command on demand via
    `extension.execute`. Extensions may also call the host LLM through
    `extension.llm.generate()`.
    """

    def __init__(self) -> None:
        self._protocol = JsonRpcProtocol()
        self._commands: dict[str, CommandHandler] = {}

        # Let extensions call the Mocu host LLM.
        self.llm = LlmApi(self._protocol)

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

        if not isinstance(context, dict):
            context = {}

        try:
            output = handler(input_value, context)

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
