import json
import sys
import threading


"""
A minimal Python Mocu extension using raw JSON-RPC over stdin/stdout.

Rust is the middleware:
  * Rust forwards host requests into this process's stdin.
  * This extension answers requests it understands on stdout.
  * The `llm` command sends a `mocu.llm.generate` request to the host,
    Rust forwards it to the frontend, the frontend calls the LLM, and
    Rust sends the result back here.
"""

pending: dict = {}
pending_lock = threading.Lock()
next_id = [1]


def emit(message) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def call_host(method: str, params=None):
    """Send a request to the Mocu host and wait for its answer."""
    with pending_lock:
        pid = next_id[0]
        next_id[0] += 1
        future = threading.Event()
        result = [None]
        pending[pid] = (future, result)

    emit({"method": method, "params": params or {}, "id": pid})

    if not future.wait(timeout=60):
        with pending_lock:
            pending.pop(pid, None)
        raise RuntimeError(f"Host method {method} timed out.")

    response = result[0]

    if isinstance(response, dict) and "error" in response:
        raise RuntimeError(response["error"].get("message", "Host error."))

    return response.get("result") if isinstance(response, dict) else None


def answer(request_id, result) -> None:
    emit({"id": request_id, "result": result})


def fail(request_id, message) -> None:
    emit({
        "id": request_id,
        "error": {"code": -32603, "message": message, "data": None},
    })


def handle(message: dict) -> None:
    method = message.get("method")
    params = message.get("params") or {}
    request_id = message.get("id")

    try:
        if method == "extension.initialize":
            answer(request_id, {"initialized": True})
        elif method == "extension.activate":
            answer(request_id, {"activated": True})
        elif method == "extension.deactivate":
            answer(request_id, {"deactivated": True})
        elif method == "extension.ping":
            answer(request_id, {
                "ready": True,
                "initialized": True,
                "activated": True,
            })
        elif method == "extension.execute":
            command = params.get("command")

            if command == "hello":
                answer(request_id, {
                    "ok": True,
                    "output": f"Hello from Python echo. Input: {params.get('input', '')}",
                })
            elif command == "llm":
                input_value = params.get("input") or {}
                prompt = input_value.get("prompt") or "Reply with exactly one sentence."
                llm_output = call_host("mocu.llm.generate", {"prompt": prompt})
                answer(request_id, {
                    "ok": True,
                    "output": llm_output,
                })
            else:
                fail(request_id, f"Unknown command: {command}")
        else:
            fail(request_id, f"Unknown method: {method}")
    except Exception as error:
        fail(request_id, str(error))


def reader() -> None:
    for line in sys.stdin:
        line = line.strip()

        if not line:
            continue

        try:
            message = json.loads(line)
        except Exception:
            emit({
                "id": None,
                "error": {"code": -32700, "message": "Invalid JSON."},
            })
            continue

        if "id" in message and ("result" in message or "error" in message):
            with pending_lock:
                entry = pending.pop(message["id"], None)

            if entry is not None:
                future, result = entry
                result[0] = message
                future.set()

            continue

        if isinstance(message.get("method"), str) and "id" in message:
            threading.Thread(
                target=handle,
                args=(message,),
                daemon=True,
            ).start()


reader_thread = threading.Thread(target=reader, daemon=True)
reader_thread.start()

# Keep the process alive forever while listening on stdin.
threading.Event().wait()