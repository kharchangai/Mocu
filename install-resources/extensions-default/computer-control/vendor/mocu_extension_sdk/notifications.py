from __future__ import annotations

from typing import Any


class NotificationsApi:
    """Show customizable desktop notifications through Mocu."""

    def __init__(self, protocol: Any) -> None:
        self._protocol = protocol

    def show(self, **options: Any) -> dict[str, str]:
        """Show a notification; declare ``notifications.show`` in the manifest."""
        if not options or not any(options.get(key) for key in ("title", "body", "html", "icon")):
            raise ValueError("A desktop notification needs a title, body, icon, or custom HTML.")
        return self._protocol.request("mocu.notification.show", options)
