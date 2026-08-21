from __future__ import annotations

from typing import Any, Callable

from .protocol import JsonRpcProtocol
from .types import CommandHandler


InitializeHandler = Callable[[dict[str, Any]], Any]
LifecycleHandler = Callable[[dict[str, Any]], Any]


class MocuExtension:
    def __init__(
        self,
        *,
        initialize: InitializeHandler | None = None,
        activate: LifecycleHandler | None = None,
        deactivate: LifecycleHandler | None = None,
    ) -> None:
        self._protocol = JsonRpcProtocol()
        self._commands: dict[str, CommandHandler] = {}

        self._initialize_handler = initialize
        self._activate_handler = activate
        self._deactivate_handler = deactivate

        self._initialized = False
        self._activated = False

        self._register_protocol_handlers()

    def command(
        self,
        name: str,
    ) -> Callable[[CommandHandler], CommandHandler]:
        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError(
                "Command name cannot be empty."
            )

        def decorator(
            handler: CommandHandler,
        ) -> CommandHandler:
            self.register_command(
                normalized_name,
                handler,
            )
            return handler

        return decorator

    def register_command(
        self,
        name: str,
        handler: CommandHandler,
    ) -> None:
        normalized_name = name.strip()

        if not normalized_name:
            raise ValueError(
                "Command name cannot be empty."
            )

        if normalized_name in self._commands:
            raise ValueError(
                f"Command is already registered: "
                f"{normalized_name}"
            )

        self._commands[normalized_name] = handler

    def run(self) -> None:
        self._protocol.run()

    def log(
        self,
        message: str,
        data: Any = None,
    ) -> None:
        self._send_log(
            "info",
            message,
            data,
        )

    def debug(
        self,
        message: str,
        data: Any = None,
    ) -> None:
        self._send_log(
            "debug",
            message,
            data,
        )

    def warn(
        self,
        message: str,
        data: Any = None,
    ) -> None:
        self._send_log(
            "warn",
            message,
            data,
        )

    def error(
        self,
        message: str,
        data: Any = None,
    ) -> None:
        self._send_log(
            "error",
            message,
            data,
        )

    def show_information_message(
        self,
        message: str,
    ) -> None:
        self._protocol.notify(
            "mocu.showMessage",
            {
                "type": "info",
                "message": message,
            },
        )

    def show_warning_message(
        self,
        message: str,
    ) -> None:
        self._protocol.notify(
            "mocu.showMessage",
            {
                "type": "warning",
                "message": message,
            },
        )

    def show_error_message(
        self,
        message: str,
    ) -> None:
        self._protocol.notify(
            "mocu.showMessage",
            {
                "type": "error",
                "message": message,
            },
        )

    def emit_event(
        self,
        event: str,
        payload: Any = None,
    ) -> None:
        params: dict[str, Any] = {
            "event": event,
        }

        if payload is not None:
            params["payload"] = payload

        self._protocol.notify(
            "mocu.emitEvent",
            params,
        )

    def get_settings(self) -> dict[str, Any]:
        result = self._protocol.request(
            "mocu.getSettings"
        )

        if not isinstance(result, dict):
            return {}

        return result

    def update_settings(
        self,
        settings: dict[str, Any],
    ) -> None:
        self._protocol.request(
            "mocu.updateSettings",
            {
                "settings": settings,
            },
        )

    def _register_protocol_handlers(
        self,
    ) -> None:
        self._protocol.register_handler(
            "extension.initialize",
            self._handle_initialize,
        )

        self._protocol.register_handler(
            "extension.activate",
            self._handle_activate,
        )

        self._protocol.register_handler(
            "extension.deactivate",
            self._handle_deactivate,
        )

        self._protocol.register_handler(
            "extension.execute",
            self._handle_execute,
        )

        self._protocol.register_handler(
            "extension.ping",
            self._handle_ping,
        )

    def _handle_initialize(
        self,
        params: Any,
    ) -> dict[str, bool]:
        normalized_params = (
            params
            if isinstance(params, dict)
            else {}
        )

        if self._initialize_handler is not None:
            self._initialize_handler(
                normalized_params
            )

        self._initialized = True

        return {
            "initialized": True,
        }

    def _handle_activate(
        self,
        params: Any,
    ) -> dict[str, bool]:
        if not self._initialized:
            raise RuntimeError(
                "Extension must be initialized "
                "before activation."
            )

        normalized_params = (
            params
            if isinstance(params, dict)
            else {}
        )

        if self._activate_handler is not None:
            self._activate_handler(
                normalized_params
            )

        self._activated = True

        return {
            "activated": True,
        }

    def _handle_deactivate(
        self,
        params: Any,
    ) -> dict[str, bool]:
        normalized_params = (
            params
            if isinstance(params, dict)
            else {}
        )

        if self._deactivate_handler is not None:
            self._deactivate_handler(
                normalized_params
            )

        self._activated = False

        return {
            "deactivated": True,
        }

    def _handle_execute(
        self,
        params: Any,
    ) -> dict[str, Any]:
        if not self._activated:
            raise RuntimeError(
                "Extension is not active."
            )

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
            output = handler(
                input_value,
                context,
            )

            return {
                "success": True,
                "output": output,
            }
        except Exception as error:
            return {
                "success": False,
                "error": str(error),
            }

    def _handle_ping(
        self,
        _params: Any,
    ) -> dict[str, bool]:
        return {
            "ready": True,
            "initialized": self._initialized,
            "activated": self._activated,
        }

    def _send_log(
        self,
        level: str,
        message: str,
        data: Any = None,
    ) -> None:
        params: dict[str, Any] = {
            "level": level,
            "message": message,
        }

        if data is not None:
            params["data"] = data

        self._protocol.notify(
            "mocu.log",
            params,
        )


def create_extension(
    *,
    initialize: InitializeHandler | None = None,
    activate: LifecycleHandler | None = None,
    deactivate: LifecycleHandler | None = None,
) -> MocuExtension:
    return MocuExtension(
        initialize=initialize,
        activate=activate,
        deactivate=deactivate,
    )