from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import Future
from typing import Any, Callable


RequestHandler = Callable[[Any], Any]


class JsonRpcProtocol:
    """
    Minimal stdin/stdout JSON-RPC client.

    Mocu writes `{ "method", "id", "params" }` lines to the extension's
    stdin; the matching handler runs and its result (or error) is written
    back on stdout. `request()` lets the extension call host methods (e.g.
    `mocu.llm.generate`) and await the answer.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, RequestHandler] = {}
        self._pending: dict[int, Future[Any]] = {}
        self._next_request_id = 1
        self._write_lock = threading.Lock()
        self._pending_lock = threading.Lock()

    def register_handler(
        self,
        method: str,
        handler: RequestHandler,
    ) -> None:
        self._handlers[method] = handler

    def request(
        self,
        method: str,
        params: Any = None,
        timeout: float = 90.0,
    ) -> Any:
        """Send a request to the host and wait for its response."""
        with self._pending_lock:
            request_id = self._next_request_id
            self._next_request_id += 1

            future: Future[Any] = Future()
            self._pending[request_id] = future

        message: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }

        if params is not None:
            message["params"] = params

        self._write_message(message)

        try:
            return future.result(timeout=timeout)
        except Exception:
            with self._pending_lock:
                self._pending.pop(request_id, None)
            raise

    def run(self) -> None:
        for line in sys.stdin:
            normalized_line = line.strip()

            if not normalized_line:
                continue

            self._handle_line(normalized_line)

    def _handle_line(self, line: str) -> None:
        try:
            message = json.loads(line)
        except json.JSONDecodeError as error:
            self._write_error(
                None,
                -32700,
                "Invalid JSON received.",
                str(error),
            )
            return

        if not isinstance(message, dict):
            self._write_error(
                None,
                -32600,
                "JSON-RPC message must be an object.",
            )
            return

        # A request from the host (e.g. extension.execute).
        if "method" in message and "id" in message:
            self._handle_request(message)
            return

        # A response from the host to one of our requests.
        if "result" in message:
            self._handle_success(message)
            return

        if "error" in message:
            self._handle_failure(message)

    def _handle_request(self, request: dict[str, Any]) -> None:
        request_id = request.get("id")
        method = request.get("method")

        if not isinstance(method, str):
            self._write_error(
                request_id,
                -32600,
                "Request method must be a string.",
            )
            return

        handler = self._handlers.get(method)

        if handler is None:
            self._write_error(
                request_id,
                -32601,
                f"Method not found: {method}",
            )
            return

        try:
            result = handler(request.get("params"))

            self._write_message({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": result,
            })
        except Exception as error:
            self._write_error(
                request_id,
                -32603,
                str(error),
            )

    def _handle_success(self, response: dict[str, Any]) -> None:
        request_id = response.get("id")

        with self._pending_lock:
            future = self._pending.get(request_id)

        if future is not None and not future.done():
            future.set_result(response.get("result"))

    def _handle_failure(self, response: dict[str, Any]) -> None:
        request_id = response.get("id")
        error = response.get("error", {})

        message = (
            error.get("message", "Unknown JSON-RPC error")
            if isinstance(error, dict)
            else "Unknown JSON-RPC error"
        )

        with self._pending_lock:
            future = self._pending.get(request_id)

        if future is not None and not future.done():
            future.set_exception(RuntimeError(message))

    def _write_error(
        self,
        request_id: Any,
        code: int,
        message: str,
        data: Any = None,
    ) -> None:
        error: dict[str, Any] = {
            "code": code,
            "message": message,
        }

        if data is not None:
            error["data"] = data

        self._write_message({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": error,
        })

    def _write_message(self, message: dict[str, Any]) -> None:
        serialized = json.dumps(
            message,
            ensure_ascii=False,
            separators=(",", ":"),
        )

        with self._write_lock:
            sys.stdout.write(serialized + "\n")
            sys.stdout.flush()
