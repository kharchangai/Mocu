from __future__ import annotations

import threading
from typing import Any


class ExtensionUiApi:
    """Chat interaction API bound to one extension command invocation."""

    def __init__(
        self,
        protocol: Any,
        command: str,
        context: dict[str, Any],
    ) -> None:
        self._protocol = protocol
        self._command = command
        self._context = context

    def interact(
        self,
        *,
        title: str | None = None,
        message: str | None = None,
        input: bool = False,
        input_placeholder: str | None = None,
        buttons: list[dict[str, str]] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> dict[str, Any]:
        """Show a prompt in Mocu chat and wait for the user's response.

        The result contains ``actionId`` and, when the user submitted text,
        ``input``. Declare the command with ``interactive: true`` in its
        manifest before calling this method.
        """
        params: dict[str, Any] = {
            "command": self._command,
            "context": self._context,
            "input": input,
        }
        if title is not None:
            params["title"] = title
        if message is not None:
            params["message"] = message
        if input_placeholder is not None:
            params["inputPlaceholder"] = input_placeholder
        if buttons is not None:
            params["buttons"] = buttons

        return self._protocol.request(
            "mocu.extension.interact",
            params,
            timeout=None,
            cancel_event=cancel_event,
        )
