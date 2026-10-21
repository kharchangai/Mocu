from __future__ import annotations

from typing import Any, Awaitable, Callable, TypeAlias


JsonValue: TypeAlias = Any

MaybeAwaitable: TypeAlias = (
    JsonValue | Awaitable[JsonValue]
)

CommandHandler: TypeAlias = Callable[
    [JsonValue, dict[str, JsonValue], dict[str, JsonValue]],
    MaybeAwaitable,
]
"""Handler(input, context, config).

``config`` holds the user-filled values for the manifest's ``config``
fields (API keys, URLs, ...) as filled in on the extension's card in the
Extensions page. Empty dict when the extension declares no config fields.
"""