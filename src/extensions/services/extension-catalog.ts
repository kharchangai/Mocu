import type {
  ExtensionRuntime,
} from "../types/extension";

export interface CatalogCommand {
  id: string;
  title: string;
  description?: string;
}

export interface CatalogFile {
  path: string;
  content: string;
}

/*
 * A bundled, one-click installable extension. The file contents are
 * embedded so the catalog works identically in the Vite dev server and
 * in a packaged Tauri build (no access to an unpacked source tree).
 */
export interface ExtensionCatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: ExtensionRuntime;
  entry: string;
  author: string;
  tags: string[];
  commands: CatalogCommand[];
  files: CatalogFile[];
}

/*
 * Minimal Node.js JSON-RPC extension over stdin/stdout. It answers the
 * extension.* lifecycle methods and exposes a "hello" command plus an
 * "llm" command that calls the Mocu host LLM through Rust.
 */
const HELLO_NODE_INDEX: string =
  'const rl = require("readline").createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });\n' +
  'const pending = new Map();\n' +
  'let nextId = 1;\n' +
  '\n' +
  'function write(message) {\n' +
  '  process.stdout.write(JSON.stringify(message) + "\\n");\n' +
  '}\n' +
  '\n' +
  'function answer(id, result) {\n' +
  '  write({ id, result: result ?? null });\n' +
  '}\n' +
  '\n' +
  'function fail(id, message) {\n' +
  '  write({ id, error: { code: -32603, message, data: null } });\n' +
  '}\n' +
  '\n' +
  'function requestHost(method, params) {\n' +
  '  const id = nextId++;\n' +
  '  return new Promise((resolve, reject) => {\n' +
  '    pending.set(id, (value) => { pending.delete(id); resolve(value); });\n' +
  '    write({ method, params: params ?? {}, id });\n' +
  '  });\n' +
  '}\n' +
  '\n' +
  'async function handle(method, params, requestId) {\n' +
  '  try {\n' +
  '    switch (method) {\n' +
  '      case "extension.initialize":\n' +
  '        return answer(requestId, { initialized: true });\n' +
  '      case "extension.activate":\n' +
  '        return answer(requestId, { activated: true });\n' +
  '      case "extension.deactivate":\n' +
  '        return answer(requestId, { deactivated: true });\n' +
  '      case "extension.ping":\n' +
  '        return answer(requestId, { ready: true });\n' +
  '      case "extension.execute": {\n' +
  '        const command = params.command;\n' +
  '        if (command === "hello") {\n' +
  '          return answer(requestId, { ok: true, output: "Hello from Node!" });\n' +
  '        }\n' +
  '        if (command === "llm") {\n' +
  '          const prompt = params.input?.prompt ?? "Reply with exactly one short sentence.";\n' +
  '          const output = await requestHost("mocu.llm.generate", { prompt });\n' +
  '          return answer(requestId, { ok: true, output });\n' +
  '        }\n' +
  '        return fail(requestId, "Unknown command: " + command);\n' +
  '      }\n' +
  '      default:\n' +
  '        return fail(requestId, "Unknown method: " + method);\n' +
  '    }\n' +
  '  } catch (error) {\n' +
  '    fail(requestId, error instanceof Error ? error.message : String(error));\n' +
  '  }\n' +
  '}\n' +
  '\n' +
  'rl.on("line", (line) => {\n' +
  '  const text = line.trim();\n' +
  '  if (!text) return;\n' +
  '  let message;\n' +
  '  try {\n' +
  '    message = JSON.parse(text);\n' +
  '  } catch {\n' +
  '    return fail("", "Invalid JSON.");\n' +
  '  }\n' +
  '  if ("id" in message && ("result" in message || "error" in message)) {\n' +
  '    const resolve = pending.get(message.id);\n' +
  '    if (resolve) {\n' +
  '      resolve(message.error ? message.error : message.result);\n' +
  '    }\n' +
  '    return;\n' +
  '  }\n' +
  '  if (typeof message.method !== "string" || !("id" in message)) return;\n' +
  '  void handle(message.method, message.params ?? {}, message.id);\n' +
  '});\n' +
  '\n' +
  'process.stdin.resume();\n';

const HELLO_NODE_MANIFEST = JSON.stringify(
  {
    id: "hello-node",
    name: "Hello Node",
    description: "A compact Node.js example extension. Exposes a hello command and an llm command that uses the Mocu host LLM through Rust.",
    version: "0.1.0",
    runtime: "node",
    entry: "index.js",
    commands: [
      {
        id: "hello",
        title: "Say Hello",
        description: "Returns a greeting from the Node extension.",
      },
      {
        id: "llm",
        title: "Ask Host LLM",
        description: "Sends a prompt to the Mocu host LLM.",
      },
    ],
  },
  null,
  2,
);

const HELLO_PYTHON_MAIN: string =
  'import json\n' +
  'import sys\n' +
  'import threading\n' +
  '\n' +
  'pending = {}\n' +
  'pending_lock = threading.Lock()\n' +
  'next_id = [1]\n' +
  '\n' +
  '\n' +
  'def emit(message):\n' +
  '    sys.stdout.write(json.dumps(message) + "\\n")\n' +
  '    sys.stdout.flush()\n' +
  '\n' +
  '\n' +
  'def call_host(method, params=None):\n' +
  '    with pending_lock:\n' +
  '        pid = next_id[0]\n' +
  '        next_id[0] += 1\n' +
  '        future = threading.Event()\n' +
  '        result = [None]\n' +
  '        pending[pid] = (future, result)\n' +
  '    emit({"method": method, "params": params or {}, "id": pid})\n' +
  '    future.wait(timeout=60)\n' +
  '    return result[0]\n' +
  '\n' +
  '\n' +
  'def answer(request_id, result):\n' +
  '    emit({"id": request_id, "result": result})\n' +
  '\n' +
  '\n' +
  'def fail(request_id, message):\n' +
  '    emit({"id": request_id, "error": {"code": -32603, "message": message, "data": None}})\n' +
  '\n' +
  '\n' +
  'def handle_message(message):\n' +
  '    method = message.get("method")\n' +
  '    params = message.get("params") or {}\n' +
  '    request_id = message.get("id")\n' +
  '    try:\n' +
  '        if method == "extension.initialize":\n' +
  '            answer(request_id, {"initialized": True})\n' +
  '        elif method == "extension.activate":\n' +
  '            answer(request_id, {"activated": True})\n' +
  '        elif method == "extension.deactivate":\n' +
  '            answer(request_id, {"deactivated": True})\n' +
  '        elif method == "extension.execute":\n' +
  '            command = params.get("command")\n' +
  '            if command == "hello":\n' +
  '                answer(request_id, {"ok": True, "output": "Hello from Python!"})\n' +
  '            elif command == "llm":\n' +
  '                prompt = (params.get("input") or {}).get("prompt") or "Reply with exactly one sentence."\n' +
  '                output = call_host("mocu.llm.generate", {"prompt": prompt})\n' +
  '                answer(request_id, {"ok": True, "output": output})\n' +
  '            else:\n' +
  '                fail(request_id, "Unknown command: " + command)\n' +
  '        else:\n' +
  '            fail(request_id, "Unknown method: " + method)\n' +
  '    except Exception as error:\n' +
  '        fail(request_id, str(error))\n' +
  '\n' +
  '\n' +
  'def reader():\n' +
  '    for line in sys.stdin:\n' +
  '        line = line.strip()\n' +
  '        if not line:\n' +
  '            continue\n' +
  '        try:\n' +
  '            message = json.loads(line)\n' +
  '        except Exception:\n' +
  '            continue\n' +
  '        handle_message(message)\n' +
  '\n' +
  '\n' +
  'threading.Thread(target=reader, daemon=True).start()\n' +
  'threading.Event().wait()\n';

const HELLO_PYTHON_MANIFEST = JSON.stringify(
  {
    id: "hello-python",
    name: "Hello Python",
    description: "A compact Python example extension. Exposes a hello and an llm command that uses the Mocu host LLM through Rust.",
    version: "0.1.0",
    runtime: "python",
    entry: "main.py",
    commands: [
      {
        id: "hello",
        title: "Say Hello",
        description: "Returns a greeting from the Python extension.",
      },
      {
        id: "llm",
        title: "Ask Host LLM",
        description: "Sends a prompt to the Mocu host LLM.",
      },
    ],
  },
  null,
  2,
);

export const EXTENSION_CATALOG: ExtensionCatalogEntry[] = [
  {
    id: "hello-node",
    name: "Hello Node",
    description: "A compact Node.js example extension. Try the hello command, or ask it to call the Mocu host LLM through Rust. Installs and manages as a node extension.",
    version: "0.1.0",
    runtime: "node",
    entry: "index.js",
    author: "Mocu",
    tags: ["sample", "node", "example"],
    commands: [
      { id: "hello", title: "Say Hello", description: "Returns a greeting." },
      { id: "llm", title: "Ask Host LLM", description: "Calls mocu.llm.generate through Rust." },
    ],
    files: [
      { path: "manifest.json", content: HELLO_NODE_MANIFEST },
      { path: "index.js", content: HELLO_NODE_INDEX },
    ],
  },
  {
    id: "hello-python",
    name: "Hello Python",
    description: "A compact Python extension with a hello command and host LLM access through Rust. The same lifecycle as the Node example, written in Python.",
    version: "0.1.0",
    runtime: "python",
    entry: "main.py",
    author: "Mocu",
    tags: ["python", "example"],
    commands: [
      { id: "hello", title: "Say Hello", description: "Returns a greeting." },
      { id: "llm", title: "Ask Host LLM", description: "Calls mocu.llm.generate through Rust." },
    ],
    files: [
      { path: "manifest.json", content: HELLO_PYTHON_MANIFEST },
      { path: "main.py", content: HELLO_PYTHON_MAIN },
    ],
  },
];