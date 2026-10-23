from __future__ import annotations

from typing import Any

from .protocol import JsonRpcProtocol


class DecisionApi:
    """
    Lets an extension ask typed probabilistic questions through Mocu's
    configured Jev decision model (OpenRouter Decisions API). The model does
    not generate text; it returns calibrated probabilities.
    """

    def __init__(self, protocol: JsonRpcProtocol) -> None:
        self._protocol = protocol

    def ask(
        self,
        *,
        state: Any,
        questions: dict[str, Any],
    ) -> Any:
        if state is None:
            raise ValueError("Decision ask requires a 'state' to reason about.")

        if (
            not isinstance(questions, dict)
            or not questions
        ):
            raise ValueError(
                "Decision ask requires a non-empty 'questions' object."
            )

        return self._protocol.request(
            "mocu.decision.ask",
            {
                "state": state,
                "questions": questions,
            },
        )
