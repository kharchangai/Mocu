import { createInterface } from "node:readline";

/*
 * A minimal Node.js Mocu extension with raw JSON-RPC over
 * stdin (host -> extension) and stdout (extension -> host).
 *
 * It handles `extension.*` lifecycle/execute methods, and an `llm`
 * command that calls the Mocu host method `mocu.llm.generate`.
 * Rust stays in the middle: requests go out through Rust, and the host
 * answers come back as JSON-RPC responses.
 */

const rl = createInterface({
  input: process.stdin,
  terminal: false,
  crlfDelay: Infinity,
});

const pending = new Map();
let nextId = 1;

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function requestHost(method, params) {
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) {
        reject(new Error(`Host method "${method}" timed out.`));
      }
    }, 60 * 1000);

    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject,
    });

    write({
      method,
      ...(params === undefined ? {} : { params }),
      id,
    });
  });
}

function answer(id, result) {
  write({ id, result: result ?? null });
}

function fail(id, message) {
  write({
    id,
    error: {
      code: -32603,
      message,
      data: null,
    },
  });
}

rl.on("line", (line) => {
  const text = line.trim();

  if (!text) {
    return;
  }

  let message;

  try {
    message = JSON.parse(text);
  } catch {
    write({
      id: null,
      error: {
        code: -32700,
        message: "Invalid JSON.",
      },
    });

    return;
  }

  // A response from the host to one of our in-flight requests.
  if (
    "id" in message &&
    ("result" in message || "error" in message)
  ) {
    const entry = pending.get(message.id);

    if (entry) {
      pending.delete(message.id);

      if ("error" in message) {
        entry.reject(
          new Error(
            message.error?.message ?? "Host error.",
          ),
        );
      } else {
        entry.resolve(message.result ?? null);
      }
    }

    return;
  }

  if (typeof message.method !== "string" || !("id" in message)) {
    return;
  }

  void handle(message.method, message.params ?? {}, message.id);
});

async function handle(method, params, requestId) {
  try {
    switch (method) {
      case "extension.initialize":
        return answer(requestId, { initialized: true });

      case "extension.activate":
        return answer(requestId, { activated: true });

      case "extension.deactivate":
        return answer(requestId, { deactivated: true });

      case "extension.ping":
        return answer(requestId, {
          ready: true,
          initialized: true,
          activated: true,
        });

      case "extension.execute": {
        const command = params.command;

        if (command === "hello") {
          return answer(requestId, {
            ok: true,
            output: `Hello from Node echo. Input: ${params.input ?? ""}`,
          });
        }

        if (command === "llm") {
          const prompt =
            params.input?.prompt ??
            "Reply with exactly one short sentence.";

          // Call the Mocu host LLM through Rust and wait for the reply.
          const llmOutput = await requestHost(
            "mocu.llm.generate",
            { prompt },
          );

          return answer(requestId, {
            ok: true,
            output: llmOutput,
          });
        }

        return fail(requestId, `Unknown command: ${command}`);
      }

      default:
        return fail(requestId, `Unknown method: ${method}`);
    }
  } catch (error) {
    fail(
      requestId,
      error instanceof Error ? error.message : String(error),
    );
  }
}

process.stdin.resume();