// src/services/ai/index.ts
import {
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { workflow } from "./graph";
import { getAsyncLLM } from "./llm";

/*
 * In-memory checkpointer keeps per-thread conversation history,
 * so multi-turn chats (src/chat) get real context in the agent.
 *
 * When no thread_id is passed (e.g. the voice pipeline), each call
 * runs on its own ephemeral thread, same as before.
 */
const checkpointer = new MemorySaver();

const app = workflow.compile({ checkpointer });

const throwIfAborted = (
  signal?: AbortSignal,
): void => {
  if (signal?.aborted) {
    throw new DOMException(
      "The operation was cancelled.",
      "AbortError",
    );
  }
};

/*
 * Generate a quick, stateless text answer.
 *
 * Used by extension LLM calls (`mocu.llm.generate`). Unlike
 * `chatWithMocu`, this is a single direct model completion with no
 * agent loop, no tools, and no memory retrieval — so it stays well
 * within the extension `extension.execute` timeout.
 */
export type SimpleAnswerOptions = {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
};

export const generateSimpleAnswer = async (
  prompt: string,
  signal?: AbortSignal,
  options: SimpleAnswerOptions = {},
): Promise<string> => {
  throwIfAborted(signal);

  const cleanPrompt = prompt.trim();

  if (!cleanPrompt) {
    throw new Error("User input cannot be empty.");
  }

  const llm = await getAsyncLLM("medium", {
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens,
  });

  throwIfAborted(signal);

  const messages = [
    ...(options.systemPrompt
      ? [new SystemMessage(options.systemPrompt)]
      : []),
    new HumanMessage(cleanPrompt),
  ];

  const response = await llm.invoke(
    messages,
    signal ? { signal } : undefined,
  );

  throwIfAborted(signal);

  const content = response.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block &&
              typeof block === "object" &&
              "text" in block &&
              typeof block.text === "string"
            ? block.text
            : "",
      )
      .join("")
      .trim();
  }

  return content == null ? "" : String(content);
};

export const chatWithMocu = async (
  userInput: string,
  signal?: AbortSignal,
  threadId?: string,
): Promise<string> => {
  throwIfAborted(signal);

  try {
    const cleanUserInput = userInput.trim();

    if (!cleanUserInput) {
      throw new Error("User input cannot be empty.");
    }

    const inputs = {
      messages: [
        new HumanMessage(cleanUserInput),
      ],
    };

    /*
     * Passing signal to LangGraph lets supported nodes and nested
     * LangChain calls stop when AbortController.abort() is called.
     *
     * When a threadId is given, the graph resumes the same
     * conversation (checkpointed history) instead of starting fresh.
     */
    const finalState = await app.invoke(
      inputs,
      threadId
        ? {
            signal,
            configurable: { thread_id: threadId },
          }
        : { signal },
    );

    throwIfAborted(signal);

    if (
      !finalState.messages ||
      finalState.messages.length === 0
    ) {
      return "No messages returned from graph.";
    }

    const lastMessage =
      finalState.messages[
        finalState.messages.length - 1
      ];

    const content = lastMessage.content;

    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === "string") {
            return block;
          }

          if (
            block &&
            typeof block === "object" &&
            "text" in block &&
            typeof block.text === "string"
          ) {
            return block.text;
          }

          return "";
        })
        .join("")
        .trim();
    }

    if (content === null || content === undefined) {
      return "";
    }

    return JSON.stringify(content);
  } catch (error: unknown) {
    /*
     * An interruption is expected behavior, not an AI failure.
     * Re-throw it so App.tsx can silently stop the current pipeline.
     */
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw error;
    }

    console.error("Error in Mocu Graph:", error);

    return "I encountered an error while processing your request.";
  }
};