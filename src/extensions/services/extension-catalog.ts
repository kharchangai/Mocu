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
 * A minimal Node.js JSON-RPC extension over stdin/stdout. It only handles
 * `extension.execute` (no lifecycle, no host calls) and returns the host's
 * OS / system information. This is the canonical "execution on demand"
 * example: install it, then run its `sysinfo` command from a chat message.
 */
const SYSINFO_NODE_INDEX =
  'const os = require("node:os");\n' +
  'const { createInterface } = require("node:readline");\n' +
  '\n' +
  'const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });\n' +
  '\n' +
  'function write(message) {\n' +
  '  process.stdout.write(JSON.stringify(message) + "\\n");\n' +
  '}\n' +
  '\n' +
  'function fail(id, message) {\n' +
  '  write({ id, error: { code: -32603, message, data: null } });\n' +
  '}\n' +
  '\n' +
  'function answer(id, result) {\n' +
  '  write({ id, result: result ?? null });\n' +
  '}\n' +
  '\n' +
  'function sysinfo() {\n' +
  '  const type = os.type();\n' +
  '  const release = os.release();\n' +
  '  return [\n' +
  '    "SYSTEM INFORMATION",\n' +
  '    "==================",\n' +
  '    `OS:               ${type} ${release}`,\n' +
  '    `Platform/arch:    ${os.platform()} ${os.arch()}`,\n' +
  '    `Hostname:         ${os.hostname()}`,\n' +
  '    `CPU cores:        ${os.cpus().length}`,\n' +
  '    `Total memory:     ${(os.totalmem() / 1024 ** 3).toFixed(2)} GB`,\n' +
  '    `Free memory:      ${(os.freemem() / 1024 ** 3).toFixed(2)} GB`,\n' +
  '    `Uptime:           ${os.uptime()}s`,\n' +
  '  ].join("\\n");\n' +
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
  '  if (typeof message.method !== "string" || !("id" in message)) return;\n' +
  '  if (message.method !== "extension.execute") {\n' +
  '    return fail(message.id, "Unknown method: " + message.method);\n' +
  '  }\n' +
  '  const command = message.params?.command;\n' +
  '  if (command === "sysinfo") return answer(message.id, { success: true, output: sysinfo() });\n' +
  '  return fail(message.id, "Unknown command: " + command);\n' +
  '});\n' +
  '\n' +
  'process.stdin.resume();\n';

const SYSINFO_NODE_MANIFEST = JSON.stringify(
  {
    id: "sysinfo-node",
    name: "System Info",
    description: "A minimal Node.js example. Returns OS and system details when called. Showcases on-demand execution with no lifecycle or host dependencies.",
    version: "0.1.0",
    runtime: "node",
    entry: "index.js",
    commands: [
      {
        id: "sysinfo",
        title: "Get system info",
        description: "Returns OS, platform, CPU and memory details.",
      },
    ],
  },
  null,
  2,
);

/*
 * A minimal Node.js JSON-RPC extension that calls the Mocu host LLM.
 * It answers `extension.execute` and, for the "ask" command, sends a
 * `mocu.llm.generate` request back to the host, waits for the generated
 * text, and returns it as the command output.
 *
 * Written in raw JSON-RPC (no SDK dependency) so it can be bundled and
 * installed with one click.
 */
const ASK_LLM_NODE_INDEX =
  'const { createInterface } = require("node:readline");\n' +
  'const rl = createInterface({ input: process.stdin, terminal: false, crlfDelay: Infinity });\n' +
  'const pending = new Map();\n' +
  'let nextId = 1;\n' +
  '\n' +
  'function write(message) {\n' +
  '  process.stdout.write(JSON.stringify(message) + "\\n");\n' +
  '}\n' +
  'function answer(id, result) { write({ id, result: result ?? null }); }\n' +
  'function fail(id, message) { write({ id, error: { code: -32603, message, data: null } }); }\n' +
  '\n' +
  '// Send a request to the Mocu host and wait for its response.\n' +
  'function requestHost(method, params) {\n' +
  '  return new Promise((resolve, reject) => {\n' +
  '    const id = nextId++;\n' +
  '    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out.")); }, 90000);\n' +
  '    pending.set(id, (value) => { clearTimeout(timer); resolve(value); });\n' +
  '    write({ method, params: params ?? {}, id });\n' +
  '  });\n' +
  '}\n' +
  '\n' +
  'async function handle(method, params, requestId) {\n' +
  '  try {\n' +
  '    if (method !== "extension.execute") return fail(requestId, "Unknown method: " + method);\n' +
  '    const command = params.command;\n' +
  '    if (command === "ask") {\n' +
  '      const prompt = params.input?.prompt || "Reply with exactly one short sentence.";\n' +
  '      const result = await requestHost("mocu.llm.generate", { prompt });\n' +
  '      const text = result && result.text ? result.text : String(result);\n' +
  '      return answer(requestId, { success: true, output: text });\n' +
  '    }\n' +
  '    return fail(requestId, "Unknown command: " + command);\n' +
  '  } catch (e) {\n' +
  '    fail(requestId, e instanceof Error ? e.message : String(e));\n' +
  '  }\n' +
  '}\n' +
  '\n' +
  'rl.on("line", (line) => {\n' +
  '  const text = line.trim();\n' +
  '  if (!text) return;\n' +
  '  let message;\n' +
  '  try { message = JSON.parse(text); } catch { return fail("", "Invalid JSON."); }\n' +
  '  // A response from the host (mocu.llm.generate reply).\n' +
  '  if ("id" in message && ("result" in message || "error" in message)) {\n' +
  '    const resolve = pending.get(message.id);\n' +
  '    if (resolve) { pending.delete(message.id); resolve(message.error ? message.error : message.result); }\n' +
  '    return;\n' +
  '  }\n' +
  '  if (typeof message.method !== "string" || !("id" in message)) return;\n' +
  '  void handle(message.method, message.params ?? {}, message.id);\n' +
  '});\n' +
  '\n' +
  'process.stdin.resume();\n';

const ASK_LLM_NODE_MANIFEST = JSON.stringify(
  {
    id: "ask-llm-node",
    name: "Ask LLM",
    description: "A minimal Node.js example that calls the Mocu host LLM and returns the generated text.",
    version: "0.1.0",
    runtime: "node",
    entry: "index.js",
    commands: [
      {
        id: "ask",
        title: "Ask the LLM",
        description: "Sends a prompt to Mocu's configured model and returns its text response.",
      },
    ],
  },
  null,
  2,
);

export const EXTENSION_CATALOG: ExtensionCatalogEntry[] = [
  {
    id: "sysinfo-node",
    name: "System Info (Node)",
    description: "Minimal Node.js extension that reports OS, CPU and memory. Installs and runs on demand from chat — no lifecycle, no host calls.",
    version: "0.1.0",
    runtime: "node",
    entry: "index.js",
    author: "Mocu",
    tags: ["node", "sample", "minimal"],
    commands: [
      {
        id: "sysinfo",
        title: "Get system info",
        description: "Returns OS, platform, CPU and memory details.",
      },
    ],
    files: [
      { path: "manifest.json", content: SYSINFO_NODE_MANIFEST },
      { path: "index.js", content: SYSINFO_NODE_INDEX },
    ],
  },
  {
    id: "ask-llm-node",
    name: "Ask LLM (Node)",
    description: "Minimal Node.js extension that calls Mocu's configured LLM through the host and returns the generated text. Demonstrates on-demand host-LLM access from an extension.",
    version: "0.1.0",
    runtime: "node",
    entry: "index.js",
    author: "Mocu",
    tags: ["node", "llm", "sample"],
    commands: [
      {
        id: "ask",
        title: "Ask the LLM",
        description: "Sends a prompt to Mocu's configured model and returns its text response.",
      },
    ],
    files: [
      { path: "manifest.json", content: ASK_LLM_NODE_MANIFEST },
      { path: "index.js", content: ASK_LLM_NODE_INDEX },
    ],
  },
];