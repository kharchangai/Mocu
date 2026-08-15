import readline from "node:readline";

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * The only way to send data to stdout.
 * Rust reads each stdout line as an independent JSON object.
 */
function send(data) {
  process.stdout.write(`${JSON.stringify(data)}\n`);
}

/**
 * Normal and debug logs must go to stderr so the JSONL output is not corrupted.
 */
function log(...values) {
  console.error("[pi-sidecar]", ...values);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  log("Creating Pi session...");

  const modelRuntime = await ModelRuntime.create();

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    modelRuntime,
  });

  /*
   * Each request in this version runs sequentially, so a single identifier
   * is enough for the active request.
   */
  let activeRequestId = null;

  session.subscribe((event) => {
    try {
      // Only send the new text portion.
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      ) {
        send({
          type: "text_delta",
          requestId: activeRequestId,
          delta: event.assistantMessageEvent.delta,
        });

        return;
      }

      // Usage information at the end of the response
      if (
        event.type === "message_end" &&
        event.message?.role === "assistant"
      ) {
        send({
          type: "message_end",
          requestId: activeRequestId,
          usage: event.message.usage ?? null,
          stopReason: event.message.stopReason ?? null,
          responseId: event.message.responseId ?? null,
        });

        return;
      }

      // Results of the tools that Pi executed
      if (event.type === "turn_end") {
        send({
          type: "turn_end",
          requestId: activeRequestId,
          toolResults: event.toolResults ?? [],
        });
      }
    } catch (error) {
      log("Failed to process Pi event:", error);
    }
  });

  const input = readline.createInterface({
    input: process.stdin,
    terminal: false,
    crlfDelay: Infinity,
  });

  /*
   * Requests are queued so that two simultaneous prompts
   * don't corrupt activeRequestId.
   */
  let queue = Promise.resolve();

  input.on("line", (line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    queue = queue
      .then(() => handleCommand(trimmedLine))
      .catch((error) => {
        log("Unexpected queue error:", error);
      });
  });

  async function handleCommand(line) {
    let command;

    try {
      command = JSON.parse(line);
    } catch (error) {
      send({
        type: "error",
        requestId: null,
        code: "INVALID_JSON",
        message: `Invalid JSON: ${getErrorMessage(error)}`,
      });

      return;
    }

    if (!command || typeof command !== "object") {
      send({
        type: "error",
        requestId: null,
        code: "INVALID_COMMAND",
        message: "Command must be a JSON object.",
      });

      return;
    }

    if (command.type === "ping") {
      send({
        type: "pong",
        requestId: command.requestId ?? null,
      });

      return;
    }

    if (command.type !== "prompt") {
      send({
        type: "error",
        requestId: command.requestId ?? null,
        code: "UNKNOWN_COMMAND",
        message: `Unknown command type: ${String(command.type)}`,
      });

      return;
    }

    if (
      typeof command.message !== "string" ||
      command.message.trim() === ""
    ) {
      send({
        type: "error",
        requestId: command.requestId ?? null,
        code: "INVALID_MESSAGE",
        message: "Prompt message must be a non-empty string.",
      });

      return;
    }

    const requestId =
      typeof command.requestId === "string" && command.requestId
        ? command.requestId
        : crypto.randomUUID();

    activeRequestId = requestId;

    send({
      type: "prompt_start",
      requestId,
    });

    try {
      await session.prompt(command.message);

      send({
        type: "prompt_complete",
        requestId,
      });
    } catch (error) {
      send({
        type: "error",
        requestId,
        code: "PROMPT_FAILED",
        message: getErrorMessage(error),
      });
    } finally {
      activeRequestId = null;
    }
  }

  input.on("close", () => {
    log("stdin closed; shutting down.");
    process.exit(0);
  });

  send({
    type: "ready",
    pid: process.pid,
  });

  log("Pi sidecar is ready.");
}

main().catch((error) => {
  send({
    type: "fatal_error",
    requestId: null,
    message: getErrorMessage(error),
  });

  console.error("[pi-sidecar] Fatal error:", error);
  process.exit(1);
});