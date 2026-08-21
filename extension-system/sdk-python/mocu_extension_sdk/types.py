from __future__ import annotations

from typing import Any, Awaitable, Callable, TypeAlias


JsonValue: TypeAlias = Any

MaybeAwaitable: TypeAlias = (
    JsonValue | Awaitable[JsonValue]
)

CommandHandler: TypeAlias = Callable[
    [JsonValue, dict[str, JsonValue]],
    MaybeAwaitable,
]