from __future__ import annotations

import asyncio
import inspect
import json
import sys
import threading
from concurrent.futures import Future
from typing import Any, Callable


RequestHandler = Callable[[Any], Any]


class JsonRpcProtocol:
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

    def notify(
        self,
        method: str,
        params: Any = None,
    ) -> None:
        message: dict[str, Any] = {
            "jsonrpc": "2.0",
            "method": method,
        }

        if params is not None:
            message["params"] = params

        self._write_message(message)

    def request(
        self,
        method: str,
        params: Any = None,
        timeout: float = 30.0,
    ) -> Any:
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
        finally:
            with self._pending_lock:
                self._pending.pop(request_id, None)

    def run(self) -> None:
        for line in sys.stdin:
            normalized_line = line.strip()

            if not normalized_line:
                continue

            self._handle_line(normalized_line)

    def _handle_line(
        self,
        line: str,
    ) -> None:
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

        if "method" in message:
            if "id" in message:
                self._handle_request(message)
            else:
                self._handle_notification(message)
            return

        if "result" in message:
            self._handle_success(message)
            return

        if "error" in message:
            self._handle_failure(message)

    def _handle_request(
        self,
        request: dict[str, Any],
    ) -> None:
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
            result = self._execute_handler(
                handler,
                request.get("params"),
            )

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

    def _handle_notification(
        self,
        notification: dict[str, Any],
    ) -> None:
        method = notification.get("method")

        if not isinstance(method, str):
            return

        handler = self._handlers.get(method)

        if handler is None:
            return

        try:
            self._execute_handler(
                handler,
                notification.get("params"),
            )
        except Exception as error:
            print(
                f"[Mocu Extension SDK] "
                f"Notification handler failed: {error}",
                file=sys.stderr,
                flush=True,
            )

    def _handle_success(
        self,
        response: dict[str, Any],
    ) -> None:
        request_id = response.get("id")

        with self._pending_lock:
            future = self._pending.get(request_id)

        if future is not None and not future.done():
            future.set_result(response.get("result"))

    def _handle_failure(
        self,
        response: dict[str, Any],
    ) -> None:
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

    def _execute_handler(
        self,
        handler: RequestHandler,
        params: Any,
    ) -> Any:
        result = handler(params)

        if inspect.isawaitable(result):
            return asyncio.run(result)

        return result

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

    def _write_message(
        self,
        message: dict[str, Any],
    ) -> None:
        serialized = json.dumps(
            message,
            ensure_ascii=False,
            separators=(",", ":"),
        )

        with self._write_lock:
            sys.stdout.write(serialized + "\n")
            sys.stdout.flush()