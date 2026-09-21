/*
 * Tracks the chat conversation that currently owns a running agent request.
 *
 * Extension commands started by the agent register a recovery job with this
 * id, so if the webview reloads (or the app restarts) mid-run, the recovered
 * extension result can be routed back to the right conversation.
 */

let activeRequestChatId: string | null = null;

export function setActiveRequestChat(chatId: string | null): void {
  activeRequestChatId =
    typeof chatId === "string" && chatId.trim() !== ""
      ? chatId
      : null;
}

export function getActiveRequestChatId(): string | null {
  return activeRequestChatId;
}
