// src/services/ai/model-stream.ts
//
// Streaming model calls that report what the model is doing live.
//
// The agents used to call `llm.invoke(...)`, so the chat only saw tool
// boxes appear and then the final answer. These helpers call
// `llm.stream(...)` instead and report every delta as it arrives:
//
//   - reasoning / thinking deltas  -> a live "thought" in the chat
//   - ordinary text deltas         -> the live answer preview
//
// The streamed chunks are aggregated with `concat`, so the returned
// message is exactly what `invoke()` would have returned (including
// tool calls) and every existing agent loop keeps working unchanged.

import {
  AIMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";

import type { RunnableConfig } from "@langchain/core/runnables";

export type ModelStreamHandlers = {
  /*
   * Called once at the start of every attempt of this model call, so
   * callers can reset their trace before the first delta arrives.
   */
  onStart?: () => void;

  /*
   * Called with the FULL thinking text accumulated so far.
   */
  onThinking?: (accumulated: string) => void;

  /*
   * Called with the FULL answer text accumulated so far.
   */
  onText?: (accumulated: string) => void;
};

/*
 * Deliberately loose: the agents pass `llm.bindTools(...)` runnable
 * bindings, and a structural type keeps this file free of LangChain
 * generic gymnastics.
 */
export type StreamableChatModel = {
  stream(
    input: unknown,
    config?: unknown,
  ): unknown;
};

type ChunkLike = {
  content?: unknown;
  additional_kwargs?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
};

/*
 * How often accumulated text is pushed to the handlers while the model
 * streams — small enough that the text grows smoothly, word by word
 * (the rows are memoized, so each push only re-renders the one line
 * that actually changed).
 */
const EMIT_INTERVAL_MS = 60;

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/*
 * Content blocks differ per provider: Anthropic-style blocks carry
 * `{ type: "thinking", thinking }`, OpenAI-style ones carry
 * `{ type: "text", text }`. Anything unknown is ignored.
 */
const extractBlockDelta = (
  block: unknown,
): { thinking: string; text: string } => {
  if (!block || typeof block !== "object") {
    return { thinking: "", text: "" };
  }

  const record = block as Record<string, unknown>;
  const type = asString(record.type);

  if (
    type === "thinking" ||
    type === "reasoning" ||
    type === "reasoning_content" ||
    type === "reasoning_summary_text_delta" ||
    type === "thinking_delta"
  ) {
    /*
     * Some providers wrap reasoning in summary parts
     * (`{ type: "reasoning", summary: [{ text }] }`).
     */
    const summary = record.summary;
    const summaryText = Array.isArray(summary)
      ? summary
          .map((part) =>
            asString(
              (part as Record<string, unknown> | null)?.text,
            ),
          )
          .join("")
      : "";

    return {
      thinking:
        asString(record.thinking) ||
        asString(record.reasoning) ||
        asString(record.text) ||
        asString(record.delta) ||
        summaryText,
      text: "",
    };
  }

  if (
    type === "text" ||
    type === "output_text" ||
    type === "input_text"
  ) {
    return { thinking: "", text: asString(record.text) };
  }

  return { thinking: "", text: "" };
};

/*
 * Splits one streamed chunk into a thinking delta and a text delta.
 * Reasoning models expose their thoughts in provider-specific places
 * (reasoning_content for DeepSeek-style, reasoning for OpenRouter,
 * thinking blocks for Anthropic-style content), so all of them are
 * checked.
 */
export const extractStreamDeltas = (
  chunk: ChunkLike,
): { thinking: string; text: string } => {
  let thinking = "";
  let text = "";

  const kwargs =
    (chunk.additional_kwargs ?? {}) as Record<string, unknown>;

  thinking +=
    asString(kwargs.reasoning_content) +
    asString(kwargs.reasoning) +
    asString(kwargs.thinking);

  thinking +=
    asString(chunk.reasoning_content) +
    asString(chunk.reasoning);

  const content = chunk.content;

  if (typeof content === "string") {
    text += content;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      const delta = extractBlockDelta(block);
      thinking += delta.thinking;
      text += delta.text;
    }
  }

  return { thinking, text };
};

/*
 * Streams one model call, reporting live deltas and returning the same
 * message `invoke()` would have produced.
 */
export const streamChatModelWithTrace = async ({
  model,
  messages,
  config,
  handlers,
}: {
  model: StreamableChatModel;
  messages: BaseMessage[];
  config?: RunnableConfig;
  handlers?: ModelStreamHandlers;
}): Promise<AIMessage> => {
  handlers?.onStart?.();

  const stream = (await model.stream(
    messages,
    config,
  )) as AsyncIterable<unknown>;

  let aggregated: AIMessageChunk | null =
    null;

  let thinking = "";
  let text = "";

  let lastEmit = 0;
  let lastEmittedThinking = "";
  let lastEmittedText = "";

  const emit = (force: boolean): void => {
    if (
      thinking === lastEmittedThinking &&
      text === lastEmittedText
    ) {
      return;
    }

    const now = Date.now();

    if (
      !force &&
      now - lastEmit <
        EMIT_INTERVAL_MS
    ) {
      return;
    }

    lastEmit = now;
    lastEmittedThinking = thinking;
    lastEmittedText = text;

    if (thinking) {
      handlers?.onThinking?.(thinking);
    }

    handlers?.onText?.(text);
  };

  for await (const chunk of stream) {
    if (!chunk) {
      continue;
    }

    const messageChunk =
      chunk as AIMessageChunk;

    aggregated = aggregated
      ? aggregated.concat(messageChunk)
      : messageChunk;

    const deltas = extractStreamDeltas(
      chunk as ChunkLike,
    );

    if (deltas.thinking) {
      thinking += deltas.thinking;
    }

    if (deltas.text) {
      text += deltas.text;
    }

    emit(false);
  }

  emit(true);

  if (!aggregated) {
    throw new Error(
      "The model stream returned no message.",
    );
  }

  return new AIMessage({
    id: aggregated.id,
    content: aggregated.content,
    additional_kwargs:
      aggregated.additional_kwargs ?? {},
    ...(aggregated.tool_calls?.length
      ? { tool_calls: aggregated.tool_calls }
      : {}),
    ...(aggregated.invalid_tool_calls?.length
      ? {
          invalid_tool_calls:
            aggregated.invalid_tool_calls,
        }
      : {}),
    ...(aggregated.usage_metadata
      ? {
          usage_metadata:
            aggregated.usage_metadata,
        }
      : {}),
    ...(aggregated.response_metadata
      ? {
          response_metadata:
            aggregated.response_metadata,
        }
      : {}),
  });
};