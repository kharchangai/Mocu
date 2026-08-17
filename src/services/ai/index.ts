// src/services/ai/index.ts
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { workflow } from "./graph";

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