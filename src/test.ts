// import { readTextFile } from "@tauri-apps/plugin-fs";
// import type { ConversationTurn } from "./chat/project/memory/memory-retrieval/continuityAnalyzer";
// import { findRecentRelatedTurns } from "./chat/project/memory/memory-retrieval/recentRelatedTurns";

// const CHAT_JSON_PATH = "E:/mocube/mocu/.mocu/memory/chat.json";
// const MAX_INPUT_TURNS = 10;

// interface StoredChatMessage {
//   role?: unknown;
//   content?: unknown;
// }

// interface StoredChat {
//   chatId?: unknown;
//   messages?: unknown;
// }

/** Runs against the latest user/assistant pairs saved in this project's chat. */
export async function runTest(): Promise<void> {
  // console.group("[findRecentRelatedTurns test]");

  // try {
  //   console.log("Reading chat history:", CHAT_JSON_PATH);
  //   const chatJson = await readTextFile(CHAT_JSON_PATH);
  //   const chat = JSON.parse(chatJson) as StoredChat;

  //   if (!Array.isArray(chat.messages)) {
  //     throw new Error('The chat history does not contain a "messages" array.');
  //   }

  //   const allTurns = toConversationTurns(chat.messages as StoredChatMessage[]);
  //   const turns = allTurns.slice(-MAX_INPUT_TURNS);

  //   if (turns.length === 0) {
  //     console.warn("No complete user/assistant turn pairs were found.");
  //     return;
  //   }

  //   console.log(
  //     `Chat ${typeof chat.chatId === "string" ? chat.chatId : "(unknown ID)"}: ` +
  //       `${allTurns.length} complete pair(s); passing the latest ${turns.length} ` +
  //       "to findRecentRelatedTurns in chronological order.",
  //   );
  //   console.table(
  //     turns.map((turn, index) => ({
  //       inputOrder: index + 1,
  //       userMessage: turn.userMessage,
  //       agentResponse: turn.agentResponse,
  //     })),
  //   );

  //   const relatedTurns = await findRecentRelatedTurns(turns);

  //   console.log(
  //     `Related result: ${relatedTurns.length} turn(s), ordered newest to oldest.`,
  //   );
  //   relatedTurns.forEach((turn, index) => {
  //     console.log(`Result ${index + 1}:`, {
  //       userMessage: turn.userMessage,
  //       agentResponse: turn.agentResponse,
  //     });
  //   });
  //   console.log("Full result JSON:\n" + JSON.stringify(relatedTurns, null, 2));
  // } catch (error) {
  //   console.error("[findRecentRelatedTurns test] Failed:", error);
  //   throw error;
  // } finally {
  //   console.groupEnd();
  // }
}

/** Pairs each assistant reply with the most recent unanswered user message. */
// function toConversationTurns(messages: StoredChatMessage[]): ConversationTurn[] {
//   const turns: ConversationTurn[] = [];
//   let pendingUserMessage: string | null = null;

//   for (const message of messages) {
//     if (message?.role === "user") {
//       pendingUserMessage =
//         typeof message.content === "string" && message.content.trim()
//           ? message.content.trim()
//           : null;
//       continue;
//     }

//     if (message?.role === "assistant") {
//       const agentResponse =
//         typeof message.content === "string" ? message.content.trim() : "";

//       if (pendingUserMessage && agentResponse) {
//         turns.push({
//           userMessage: pendingUserMessage,
//           agentResponse,
//         });
//       }

//       // Don't accidentally pair an unanswered user message with a later reply.
//       pendingUserMessage = null;
//     }
//   }

//   return turns;
// }
