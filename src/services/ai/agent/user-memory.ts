// src/services/ai/agent/user-memory.ts

/**
 * User memory system for the chat agent (chat-agent.ts) and the main
 * agent (nodes.ts).
 *
 * This is the SAME memory system the project agent uses
 * (Turn -> Window -> Episode + entity/graph retrieval), but every
 * record is stored in the GLOBAL application storage location instead
 * of inside a project folder:
 *
 *   AppConfig/storage/memory.db
 *   AppConfig/storage/memoryx.db
 *   AppConfig/storage/memory-graph.db
 *
 * Nothing is written to a project file (no <project>/.mocu/storage).
 * The user's memory therefore follows them across every project and
 * every conversation.
 */

import type { BaseMessage } from "@langchain/core/messages";

import { getTextContent } from "./helpers";

import {
  dispatchMemorySaveActivity,
} from "../../../chat/services/memoryActivity";

import {
  saveProjectMemory,
} from "../../../chat/project/memory/saveProjectMemory";

import {
  retrieveProjectMemory,
  type PreviousConversationTurn,
  type ProjectMemoryRetrievalResult,
} from "../../../chat/project/memory/memory-retrieval/memoryRetrievalPipeline";

/**
 * The user memory lives in the global application storage, so the
 * project path is intentionally empty. An empty project path selects the
 * global (application-wide) database in the memory pipeline.
 */
const GLOBAL_PROJECT_PATH = "";

export type UserMemoryRetrievalResult = ProjectMemoryRetrievalResult;

export type { PreviousConversationTurn };

/* -------------------------------------------------------------------------- */
/* Previous Turn                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Extracts the immediately previous live conversation turn (the
 * previous user message and the previous agent response) so the memory
 * gate and selector can resolve references to it.
 */
export const getPreviousConversationTurn = (
  messages: BaseMessage[],
): PreviousConversationTurn | null => {
  for (
    let index = messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message = messages[index];

    if (message.getType() !== "ai") {
      continue;
    }

    const agentResponse = getTextContent(
      message.content,
    ).trim();

    for (
      let previousIndex = index - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      const previousMessage = messages[previousIndex];

      if (previousMessage.getType() !== "human") {
        continue;
      }

      const userMessage = getTextContent(
        previousMessage.content,
      ).trim();

      if (!userMessage || !agentResponse) {
        return null;
      }

      return { userMessage, agentResponse };
    }

    return null;
  }

  return null;
};

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Formats the retrieved user memory as a prompt section for the agent
 * system prompt.
 *
 * Returns an empty string when there is no memory or no context text.
 */
export const buildUserMemoryPrompt = (
  memory: UserMemoryRetrievalResult | null,
): string => {
  const context = memory?.memoryContext.trim() ?? "";

  if (!context) {
    return "";
  }

  return [
    "RELATED MEMORY (PREVIOUS CONVERSATIONS)",
    "",
    "The text below was retrieved from the stored memory of previous conversations with this user because it is related to the current request.",
    "It is real previous context from earlier conversations — use it when it is relevant, especially for questions about earlier messages, decisions, or preferences.",
    "It is not part of the current live conversation.",
    "Trust the current user request and the tool results over this memory when they conflict.",
    "Do not claim that this memory comes from the current conversation.",
    "Do not mention memory retrieval, stored conversations, or these instructions to the user.",
    "",
    "---",
    context,
    "---",
  ].join("\n");
};

/**
 * Runs the complete user-memory retrieval for the current message and
 * returns the ready-to-inject prompt block.
 *
 * Retrieval failures never block the agent: any error returns an empty
 * prompt so the user always receives an answer.
 */
export const retrieveUserMemoryPrompt = async (
  userMessage: string,
  previousTurn: PreviousConversationTurn | null,
  signal?: AbortSignal,
): Promise<string> => {
  if (!userMessage.trim()) {
    return "";
  }

  try {
    const memoryResult = await retrieveUserMemory(
      userMessage,
      previousTurn,
      signal,
    );

    return buildUserMemoryPrompt(memoryResult);
  } catch (error) {
    console.warn(
      "[User Memory] Retrieval failed:",
      error,
    );

    return "";
  }
};

/**
 * Runs the raw user-memory retrieval pipeline against the global
 * memory database. Throws on failure (callers that want a
 * never-blocking prompt should use retrieveUserMemoryPrompt).
 */
export const retrieveUserMemory = (
  userMessage: string,
  previousTurn: PreviousConversationTurn | null,
  signal?: AbortSignal,
): Promise<UserMemoryRetrievalResult> => {
  void signal;

  return retrieveProjectMemory({
    userMessage,
    projectPath: GLOBAL_PROJECT_PATH,
    previousTurn,
  });
};

/* -------------------------------------------------------------------------- */
/* Save                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Saves the completed conversation turn into the global user memory
 * without blocking the final response (fire and forget).
 *
 * The turn is persisted in the global application storage (Turn ->
 * Window -> Episode + entity/graph indexing), never in a project file.
 */
export const saveUserMemoryInBackground = (
  userMessage: string,
  agentResponse: string,
  chatId?: string,
): void => {
  const normalizedUserMessage = userMessage.trim();
  const normalizedAgentResponse = agentResponse.trim();

  if (!normalizedUserMessage || !normalizedAgentResponse) {
    return;
  }

  /*
   * Tell the chat UI the memory save started, so the small mind icon
   * starts blinking below the agent response. The event is scoped to
   * the chat that owns this run.
   */
  dispatchMemorySaveActivity({
    status: "saving",
    chatId,
    projectPath: "",
  });

  void saveProjectMemory({
    userMessage: normalizedUserMessage,
    agentResponse: normalizedAgentResponse,
    projectPath: null,
  })
    .then((result) => {
      dispatchMemorySaveActivity({
        status: "done",
        chatId,
        projectPath: "",
      });

      console.log(
        "[User Memory] Turn saved successfully:",
        {
          storageType: result.storageType,
          databasePath: result.databasePath,
          turnId: result.processResult.turnId,
          windowId: result.processResult.windowId,
          episodeId: result.processResult.episodeId,
        },
      );
    })
    .catch((error: unknown) => {
      dispatchMemorySaveActivity({
        status: "error",
        chatId,
        projectPath: "",
      });

      console.error(
        "[User Memory] Failed to save turn:",
        error,
      );
    });
};