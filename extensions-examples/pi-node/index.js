import { resolve } from "node:path";

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { createExtension } from "@mocu/extension-sdk";

/*
 * Mocu <-> pi bridge extension.
 *
 * Embeds a pi coding-agent session (via the pi SDK) inside this extension
 * process. Mocu invokes the "ask" command; the command sends the prompt to
 * pi, lets the agent run to completion (including tool calls), and returns
 * pi's final assistant text as the command result.
 *
 * While pi runs, every session event is streamed live to Mocu as
 * "mocu.extension.activity" notifications: LLM thinking deltas, assistant
 * text, every tool call with its arguments, streaming tool output, final
 * tool results (and errors), retries and compaction.
 *
 * Input for "ask" is either a plain string (the prompt) or an object:
 *   {
 *     prompt: string,          // required
 *     cwd?: string,            // directory pi operates on (default: process cwd)
 *     tools?: string[],        // built-in tools to enable (default: read/bash/edit/write)
 *     model?: string,          // "provider/model-id", e.g. "anthropic/claude-opus-4-5"
 *     thinkingLevel?: string   // off | minimal | low | medium | high | xhigh | max
 *   }
 *
 * The session is persistent: consecutive "ask" calls continue the same pi
 * conversation. Changing any session option (cwd/tools/model/thinkingLevel)
 * transparently recreates the session. Use "reset" to start fresh on demand.
 */

/*
 * Keep stdout pristine: Mocu speaks JSON-RPC over this process's stdout, so
 * anything written there (stray library logs, debug prints) would corrupt the
 * protocol. Route console output to stderr instead.
 */
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const THINKING_LEVELS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

/*
 * Live progress streaming. While pi runs, progress is sent to Mocu as
 * one-way notifications ("mocu.extension.activity") that the chat UI
 * renders inside the tool card of the calling agent. Deltas are buffered
 * and flushed at most every FLUSH_INTERVAL_MS to avoid flooding stdout.
 */
const ACTIVITY_METHOD = "mocu.extension.activity";
const FLUSH_INTERVAL_MS = 300;
const MAX_STREAM_TEXT_LENGTH = 60_000;
const MAX_TOOL_ARGS_CHARS = 2_000;
const MAX_TOOL_OUTPUT_CHARS = 4_000;

class ActivityStream {
  constructor(toolCallId, toolName, notify) {
    this.toolCallId = toolCallId;
    this.toolName = toolName;
    this.notifyFn = notify;
    this.buffer = "";
    this.timer = null;
    this.active = false;
  }

  start() {
    this.active = true;
  }

  append(text) {
    if (!this.active || !text) {
      return;
    }

    this.buffer += text;

    if (this.buffer.length > MAX_STREAM_TEXT_LENGTH) {
      this.buffer = `[… earlier output trimmed …]\n${this.buffer.slice(-MAX_STREAM_TEXT_LENGTH)}`;
    }

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (!this.active || !this.buffer) {
      return;
    }

    this.notifyFn(ACTIVITY_METHOD, {
      toolCallId: this.toolCallId,
      toolName: this.toolName,
      text: this.buffer,
    });
  }

  stop() {
    this.flush();
    this.active = false;
  }
}

/*
 * Log-formatting helpers. Everything ends up as plain text because the Mocu
 * chat renders the activity stream inside a <pre> block.
 */

/** Trim long text, keeping the head and (more useful) the tail. */
function truncateMiddle(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  const head = Math.floor(maxLength * 0.3);
  const tail = maxLength - head;
  return `${text.slice(0, head)}\n[… ${(text.length - maxLength).toLocaleString()} characters trimmed …]\n${text.slice(-tail)}`;
}

/** Join the text blocks of an LLM/tool content array into one string. */
function contentToText(blocks) {
  if (!Array.isArray(blocks)) {
    return "";
  }
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

/** Best-effort single-line-ish string for arbitrary values. */
function stringifyForLog(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
}

/** Extract the printable text of a tool result (result or partial result). */
function toolResultText(result) {
  if (typeof result === "string") {
    return result;
  }
  const text = contentToText(result?.content);
  if (text) {
    return text;
  }
  // Some tools only populate structured details (e.g. edit's diff) — show them.
  const details = result?.details;
  if (details && typeof details === "object" && Object.keys(details).length > 0) {
    return stringifyForLog(details);
  }
  return "";
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

/*
 * Stateful formatter that turns pi session events into a readable live log.
 * One instance per "ask" run. It shows everything the agent does:
 *
 *   - LLM thinking deltas (models/thinking levels that produce them)
 *   - assistant text deltas
 *   - every tool call with its arguments
 *   - tool output as it streams (bash output, partial results, ...)
 *   - final tool results (or errors)
 *   - auto retries, compaction and queued steering/follow-up messages
 *
 * tool_execution_update carries the ACCUMULATED partial result (pi's own TUI
 * replaces the view each update), so per tool call we remember the last seen
 * text and only emit the fresh suffix — otherwise long-running tool output
 * would be duplicated on every update.
 */
class PiRunLogFormatter {
  constructor() {
    this.turnCount = 0;
    /** toolCallId -> last seen cumulative output text */
    this.toolOutputs = new Map();
  }

  format(event) {
    try {
      return this.formatEvent(event) ?? "";
    } catch {
      return ""; // a formatting bug must never break streaming
    }
  }

  formatEvent(event) {
    switch (event?.type) {
      case "agent_start":
        this.turnCount = 0;
        this.toolOutputs.clear();
        return "\n━━━━ pi agent started ━━━━\n";

      case "turn_start": {
        this.turnCount += 1;
        return this.turnCount > 1 ? `\n──── turn ${this.turnCount} ────\n` : "";
      }

      case "message_update":
        return this.formatAssistantEvent(event.assistantMessageEvent);

      case "tool_execution_start":
        return this.formatToolStart(event);

      case "tool_execution_update":
        return this.formatToolUpdate(event);

      case "tool_execution_end":
        return this.formatToolEnd(event);

      case "agent_end":
        return event.willRetry
          ? "\n━━━━ run interrupted (will retry) ━━━━\n"
          : "\n━━━━ pi agent finished ━━━━\n";

      case "auto_retry_start":
        return `\n⚠ auto retry ${event.attempt}/${event.maxAttempts} in ${Math.round((event.delayMs ?? 0) / 1000)}s — ${truncateMiddle(String(event.errorMessage ?? ""), 300)}\n`;

      case "auto_retry_end":
        return event.success
          ? "\n✓ retry succeeded\n"
          : `\n✗ retry failed: ${truncateMiddle(String(event.finalError ?? ""), 300)}\n`;

      case "compaction_start":
        return `\n… compacting context (${event.reason ?? "auto"}) …\n`;

      case "compaction_end":
        return event.aborted
          ? "\n… compaction cancelled\n"
          : "\n… compaction finished\n";

      case "queue_update": {
        const steering = event.steering?.length ?? 0;
        const followUp = event.followUp?.length ?? 0;
        if (!steering && !followUp) {
          return "";
        }
        return `\nqueued messages: ${steering} steering, ${followUp} follow-up\n`;
      }

      default:
        return "";
    }
  }

  formatAssistantEvent(ev) {
    if (!ev) {
      return "";
    }
    switch (ev.type) {
      case "thinking_start":
        return "\n┌─ thinking ─\n";

      case "thinking_delta":
        return String(ev.delta ?? "");

      case "thinking_end":
        return "\n└─ end thinking ─\n";

      case "text_start":
        return "\n┌─ response ─\n";

      case "text_delta":
        return String(ev.delta ?? "");

      case "text_end":
        return "\n└─ end response ─\n";

      case "error": {
        const message =
          contentToText(ev.error?.content) || stringifyForLog(ev.error) || "unknown error";
        return `\n[llm error] ${truncateMiddle(message, 1_000)}\n`;
      }

      default:
        return "";
    }
  }

  formatToolStart(event) {
    const name = String(event.toolName ?? "?");
    const argsText = truncateMiddle(stringifyForLog(event.args), MAX_TOOL_ARGS_CHARS);
    const argsBlock = argsText ? `\n${indent(argsText)}` : "";
    return `\n▶ tool: ${name}${argsBlock}\n`;
  }

  formatToolUpdate(event) {
    const id = event.toolCallId;
    const text = toolResultText(event.partialResult);
    if (!text) {
      return "";
    }

    const previous = this.toolOutputs.get(id) ?? "";
    let fresh;
    if (text.startsWith(previous)) {
      fresh = text.slice(previous.length);
    } else {
      fresh = `\n[output refreshed]\n${text}`;
    }
    this.toolOutputs.set(id, text);

    if (!fresh.trim()) {
      return "";
    }
    return truncateMiddle(fresh, MAX_TOOL_OUTPUT_CHARS);
  }

  formatToolEnd(event) {
    const id = event.toolCallId;
    const name = String(event.toolName ?? "?");
    const status = event.isError ? "error" : "done";
    const text = toolResultText(event.result);
    const previous = this.toolOutputs.get(id) ?? "";
    this.toolOutputs.delete(id);

    let fresh = text.startsWith(previous) ? text.slice(previous.length) : text;
    if (event.isError && !text.startsWith(previous)) {
      // Error results replace any streamed output — show them in full.
      fresh = text;
    }

    if (!fresh.trim()) {
      return `■ ${name}: ${status}\n`;
    }
    return `■ ${name}: ${status}\n${truncateMiddle(fresh, MAX_TOOL_OUTPUT_CHARS)}\n`;
  }
}

/** The long-lived pi session, created lazily on the first "ask". */
let piSession = null;
/** Key describing how the current session was created (cwd/tools/model/...). */
let piSessionKey = null;
let modelRuntime = null;

/** Extract the text content of an assistant message. */
function extractText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** Resolve an optional "provider/model-id" string against the model runtime. */
async function resolveModel(modelString) {
  const slash = modelString.indexOf("/");
  if (slash <= 0) {
    throw new Error(
      `Invalid model "${modelString}". Use the "provider/model-id" form, e.g. "anthropic/claude-opus-4-5".`,
    );
  }
  const provider = modelString.slice(0, slash);
  const id = modelString.slice(slash + 1);

  if (!modelRuntime) {
    modelRuntime = await ModelRuntime.create();
  }
  const model = modelRuntime.getModel(provider, id);
  if (!model) {
    throw new Error(`Unknown pi model: ${modelString}`);
  }
  return { model, modelRuntime };
}

/**
 * Command serialization. The JSON-RPC layer dispatches incoming lines
 * concurrently, but pi session state (create/dispose/prompt) must never run
 * interleaved — e.g. two concurrent "ask"s would create two sessions and
 * lose shared context. All commands are chained through this queue.
 */
let commandQueue = Promise.resolve();
function serialized(handler) {
  return async (input, context) => {
    const run = commandQueue.then(() => handler(input, context));
    commandQueue = run.catch(() => {}); // keep the queue alive after errors
    return run;
  };
}
/**
 * Return the active pi session, creating (or recreating) it if the requested
 * session options differ from the current one.
 */
async function getPiSession(options) {
  const cwd = options.cwd ? resolve(String(options.cwd)) : process.cwd();

  const tools =
    Array.isArray(options.tools) && options.tools.length > 0
      ? options.tools.map(String)
      : DEFAULT_TOOLS;

  if (options.thinkingLevel !== undefined && !THINKING_LEVELS.has(options.thinkingLevel)) {
    throw new Error(
      `Invalid thinkingLevel "${options.thinkingLevel}". ` +
        `Expected one of: ${[...THINKING_LEVELS].join(", ")}.`,
    );
  }
  const thinkingLevel = options.thinkingLevel;

  const key = JSON.stringify({ cwd, tools, model: options.model, thinkingLevel });
  if (piSession && piSessionKey === key) {
    return piSession;
  }

  if (piSession) {
    piSession.dispose();
    piSession = null;
    piSessionKey = null;
  }

  const { model, modelRuntime: runtime } = options.model
    ? await resolveModel(options.model)
    : { model: undefined, modelRuntime: undefined };

  if (!modelRuntime && !model) {
    modelRuntime = await ModelRuntime.create();
  }

  const { session } = await createAgentSession({
    cwd,
    modelRuntime: model ? runtime : modelRuntime,
    model,
    thinkingLevel,
    tools,
    sessionManager: SessionManager.inMemory(cwd),
  });

  piSession = session;
  piSessionKey = key;
  return session;
}

const extension = createExtension({
  commands: {
    ask: serialized(async (input, context) => {
      const options = typeof input === "string" ? { prompt: input } : (input ?? {});
      const prompt = typeof options.prompt === "string" ? options.prompt : "";
      if (!prompt.trim()) {
        throw new Error(
          "'ask' requires a non-empty 'prompt' (a plain string or { prompt: string }).",
        );
      }

      const session = await getPiSession(options);

      /*
       * Stream pi's live progress (text deltas, tool calls) to Mocu.
       * The calling agent passes its tool-card identity via the command
       * context so the stream lands in the right chat activity box.
       */
      const stream = new ActivityStream(
        context?.toolCallId,
        context?.toolName,
        (method, params) => extension.notify(method, params),
      );

      // Track the most recent assistant text; with tool loops there can be
      // several assistant turns, and the last one is the final answer.
      let lastAssistantText = "";
      const formatter = new PiRunLogFormatter();
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "turn_end" && event.message?.role === "assistant") {
          const text = extractText(event.message);
          if (text) lastAssistantText = text;
        }

        stream.append(formatter.format(event));
      });

      stream.start();

      let runPromise = null;
      let isPaused = false;
      let wasCancelled = false;

      try {
        runPromise = session.prompt(prompt);
        while (true) {
          const interactionAbort = new AbortController();
          const interaction = context.mocu.ui.interact(
            {
              title: isPaused ? "Pi is paused" : "Pi is working",
              message: isPaused
                ? "Pi stopped at your request. Send new instructions or resume the existing task."
                : "Send a message to steer Pi, or stop its current turn and resume later.",
              input: true,
              inputPlaceholder: isPaused
                ? "Instructions for Pi to continue…"
                : "Send instructions to Pi…",
              buttons: isPaused
                ? [
                    { id: "resume", label: "Continue Pi", variant: "primary" },
                    { id: "cancel", label: "Cancel task", variant: "danger" },
                  ]
                : [
                    { id: "stop", label: "Stop Pi & wait", variant: "secondary" },
                    { id: "cancel", label: "Cancel task", variant: "danger" },
                  ],
            },
            interactionAbort.signal,
          ).then(
            (response) => ({ type: "interaction", response }),
            (error) => ({ type: "interaction-error", error }),
          );

          const outcome = runPromise
            ? await Promise.race([
                runPromise.then(
                  () => ({ type: "finished" }),
                  (error) => ({ type: "failed", error }),
                ),
                interaction,
              ])
            : await interaction;

          if (outcome.type === "finished" || outcome.type === "failed") {
            // Close the Mocu interaction card as soon as Pi finishes.
            interactionAbort.abort();
            await interaction;
            if (outcome.type === "failed") {
              throw outcome.error;
            }
            break;
          }

          if (outcome.type === "interaction-error") {
            throw outcome.error;
          }

          const { actionId, input: userMessage } = outcome.response;

          if (actionId === "cancel") {
            wasCancelled = true;
            await session.abort();
            await runPromise?.catch(() => undefined);
            runPromise = null;
            break;
          }

          if (actionId === "stop") {
            stream.append("\n[user stopped Pi; waiting for instructions]\n");
            await session.abort();
            await runPromise?.catch(() => undefined);
            runPromise = null;
            isPaused = true;
            continue;
          }

          if (actionId === "resume") {
            stream.append("\n[user resumed the Pi task]\n");
            runPromise = session.prompt(
              "Continue working on the existing task from where you stopped.",
            );
            isPaused = false;
            continue;
          }

          if (actionId === "__input__" && userMessage?.trim()) {
            const instruction = userMessage.trim();
            stream.append(`\n[user instruction] ${instruction}\n`);

            if (isPaused || !session.isStreaming) {
              // After Stop, prompt() starts another turn in the same Pi session
              // so it keeps the previous conversation and task context.
              await runPromise?.catch(() => undefined);
              runPromise = session.prompt(instruction);
              isPaused = false;
            } else {
              // While Pi is running, steer() queues the message for the next
              // turn after the current tool batch, just like Pi's own TUI.
              await session.steer(instruction);
            }
          }
        }
      } finally {
        unsubscribe();
        stream.stop();
      }

      if (wasCancelled) {
        return `Pi task cancelled by the user.${lastAssistantText ? ` Last response: ${lastAssistantText}` : ""}`;
      }

      return lastAssistantText || "(pi finished without producing any text)";
    }),

    reset: serialized(async () => {
      if (piSession) {
        piSession.dispose();
        piSession = null;
        piSessionKey = null;
        return "pi session reset. The next 'ask' starts a fresh session.";
      }
      return "No active pi session.";
    }),

    status: serialized(async () => {
      if (!piSession) {
        return { active: false };
      }
      let sessionOptions = {};
      try {
        sessionOptions = JSON.parse(piSessionKey ?? "{}");
      } catch {
        // ignore
      }
      return {
        active: true,
        cwd: sessionOptions.cwd,
        tools: sessionOptions.tools,
        model: piSession.model
          ? `${piSession.model.provider ?? "?"}/${piSession.model.id ?? "?"}`
          : undefined,
        thinkingLevel: piSession.thinkingLevel,
      };
    }),
  },
});

// Start listening for JSON-RPC messages from the Mocu host.
extension.start();
