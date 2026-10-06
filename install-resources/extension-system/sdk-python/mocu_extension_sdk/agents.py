from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol


class AgentsApi:
    """Discover and invoke agents saved by the current Mocu user."""

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def list(self) -> list[dict[str, str]]:
        """Return public metadata for the user's saved agents."""
        result = self._protocol.request("mocu.agents.list")
        if not isinstance(result, list):
            raise RuntimeError("Mocu returned an invalid agents list.")
        return result

    def run(
        self,
        agent_id: str,
        input: str,
        *,
        timeout: float | None = None,
        cancel_event: Any = None,
    ) -> dict[str, str]:
        """Run a saved agent to completion and return its response."""
        if not isinstance(agent_id, str) or not agent_id.strip():
            raise ValueError("Agent run requires a non-empty agent_id.")
        if not isinstance(input, str) or not input.strip():
            raise ValueError("Agent run requires a non-empty input string.")

        result = self._protocol.request(
            "mocu.agents.run",
            {"agentId": agent_id.strip(), "input": input.strip()},
            timeout=timeout,
            cancel_event=cancel_event,
        )
        if not isinstance(result, dict):
            raise RuntimeError("Mocu returned an invalid agent result.")
        return result
