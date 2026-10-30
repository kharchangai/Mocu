from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol


class TypedFieldsApi:
    """Extract, compute, estimate, or forecast typed values with Mocu's Extract model."""

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def typed_fields(
        self,
        state: Any,
        fields: dict[str, dict[str, Any]],
        *,
        reference_date: str | None = None,
    ) -> dict[str, Any]:
        if state is None or (isinstance(state, str) and not state.strip()) or state == []:
            raise ValueError("Typed field extraction requires non-empty state.")
        if not isinstance(fields, dict) or not fields:
            raise ValueError("Typed field extraction requires at least one field definition.")

        params: dict[str, Any] = {"state": state, "fields": fields}
        if reference_date is not None:
            params["reference_date"] = reference_date
        return self._protocol.request("mocu.extract.typed_fields", params)
