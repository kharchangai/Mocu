import type { ChatConversation } from '../types/chat';

import { normalizeHistoryFilePath } from '../services/projectChatHistory';

const CHAT_STORAGE_KEY = 'mocu-chat-history-v1';

function isChatConversation(value: unknown): value is ChatConversation {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const chat = value as Partial<ChatConversation>;

  return (
    typeof chat.id === 'string' &&
    typeof chat.title === 'string' &&
    Array.isArray(chat.messages) &&
    (chat.projectPath === undefined ||
      typeof chat.projectPath === 'string') &&
    (chat.historyFilePath === undefined ||
      typeof chat.historyFilePath === 'string') &&
    typeof chat.createdAt === 'string' &&
    typeof chat.updatedAt === 'string'
  );
}

export function loadChats(): ChatConversation[] {
  try {
    const storedValue = localStorage.getItem(CHAT_STORAGE_KEY);

    if (!storedValue) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter(isChatConversation)
      .map((chat) => ({
        ...chat,
        historyFilePath: chat.historyFilePath ?? '',
      }))
      /*
       * Heal any conversations duplicated by earlier bugs: the same
       * chat (same ID or same project history file) is never listed
       * twice, so the persisted state cannot regress into duplicates.
       */
      .filter((chat, index, allChats) => {
        const firstIndexWithId = allChats.findIndex(
          (otherChat) => otherChat.id === chat.id,
        );

        if (firstIndexWithId !== index) {
          return false;
        }

        if (!chat.historyFilePath) {
          return true;
        }

        const normalizedFilePath = normalizeHistoryFilePath(
          chat.historyFilePath,
        );

        const firstIndexWithFile = allChats.findIndex(
          (otherChat) =>
            otherChat.historyFilePath &&
            normalizeHistoryFilePath(otherChat.historyFilePath) ===
              normalizedFilePath,
        );

        return firstIndexWithFile === index;
      })
      .sort(
        (firstChat, secondChat) =>
          new Date(secondChat.updatedAt).getTime() -
          new Date(firstChat.updatedAt).getTime(),
      );
  } catch (error) {
    console.error('[Chat Storage] Failed to load chats:', error);
    return [];
  }
}

export function saveChats(chats: ChatConversation[]): void {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.error('[Chat Storage] Failed to save chats:', error);
  }
}

export function clearStoredChats(): void {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
  } catch (error) {
    console.error('[Chat Storage] Failed to clear chats:', error);
  }
}