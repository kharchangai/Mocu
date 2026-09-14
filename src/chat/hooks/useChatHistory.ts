import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadChats, saveChats } from '../storage/chat-storage';
import {
  getProjectHistoryFilePath,
  loadProjectConversationFile,
  normalizeHistoryFilePath,
  saveProjectConversationFile,
} from '../services/projectChatHistory';
import type {
  ChatConversation,
  ChatMessage,
  ChatRole,
  RecentChat,
} from '../types/chat';

const MAX_CHAT_TITLE_LENGTH = 48;

function createId(prefix: string): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 11)}`;
}

function createTitle(content: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();

  if (!normalizedContent) {
    return 'New conversation';
  }

  if (normalizedContent.length <= MAX_CHAT_TITLE_LENGTH) {
    return normalizedContent;
  }

  return `${normalizedContent.slice(0, MAX_CHAT_TITLE_LENGTH).trim()}...`;
}

function createMessage(
  role: ChatRole,
  content: string,
): ChatMessage {
  return {
    id: createId('message'),
    role,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };
}

function sortChats(chats: ChatConversation[]): ChatConversation[] {
  return [...chats].sort(
    (firstChat, secondChat) =>
      new Date(secondChat.updatedAt).getTime() -
      new Date(firstChat.updatedAt).getTime(),
  );
}

export type AddMessageResult = {
  chatId: string;
  message: ChatMessage;
};

export type EnsureChatResult = {
  chatId: string;
  wasCreated: boolean;
};

export function useChatHistory() {
  const [chats, setChats] = useState<ChatConversation[]>(() => loadChats());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    saveChats(chats);
  }, [chats]);

  const activeChat = useMemo(() => {
    if (!activeChatId) {
      return null;
    }

    return chats.find((chat) => chat.id === activeChatId) ?? null;
  }, [activeChatId, chats]);

  const recentChats = useMemo<RecentChat[]>(
    () =>
      sortChats(chats).map((chat) => ({
        id: chat.id,
        title: chat.title,
      })),
    [chats],
  );

  const startNewChat = useCallback(() => {
    setActiveChatId(null);
  }, []);

  const selectChat = useCallback(
    (chatId: string) => {
      const chatExists = chats.some((chat) => chat.id === chatId);

      if (!chatExists) {
        console.warn(`[Chat History] Chat not found: ${chatId}`);
        return;
      }

      setActiveChatId(chatId);
    },
    [chats],
  );

  const createChat = useCallback(
    (
      firstUserMessage: string,
      projectPath = '',
      initialMessages: ChatMessage[] = [],
    ): AddMessageResult => {
      const normalizedMessage = firstUserMessage.trim();

      if (!normalizedMessage) {
        throw new Error('The first message cannot be empty.');
      }

      const now = new Date().toISOString();
      const chatId = createId('chat');
      const message = createMessage('user', normalizedMessage);

      const normalizedProjectPath = projectPath.trim();

      /*
       * A project chat owns a persistent history file so every new
       * message is appended to the same file on disk.
       */
      const isProjectChat = normalizedProjectPath.length > 0;

      const historyFilePath = isProjectChat
        ? getProjectHistoryFilePath(normalizedProjectPath)
        : '';

      /*
       * A new chat may be seeded with the project's persisted memory
       * history so past messages stay part of the conversation.
       */
      const newChat: ChatConversation = {
        id: chatId,
        title: createTitle(normalizedMessage),
        messages: [...initialMessages, message],
        projectPath: normalizedProjectPath,
        historyFilePath,
        createdAt: now,
        updatedAt: now,
      };

      setChats((currentChats) => [newChat, ...currentChats]);
      setActiveChatId(chatId);

      if (isProjectChat) {
        void saveProjectConversationFile(newChat);
      }

      return {
        chatId,
        message,
      };
    },
    [],
  );

  const addMessage = useCallback(
    (
      chatId: string,
      role: ChatRole,
      content: string,
    ): ChatMessage => {
      const normalizedContent = content.trim();

      if (!normalizedContent) {
        throw new Error('The message cannot be empty.');
      }

      const message = createMessage(role, normalizedContent);
      const updatedAt = new Date().toISOString();

      /*
       * Resolve the target conversation from the latest chats state
       * inside the updater. Looking it up from the closure could miss
       * a conversation that was just created or loaded in the same
       * async flow, silently dropping the message ("Chat not found").
       */
      setChats((currentChats) => {
        const existingChat = currentChats.find(
          (chat) => chat.id === chatId,
        );

        if (!existingChat) {
          console.error(
            `[Chat History] Chat not found: ${chatId}`,
          );

          return currentChats;
        }

        const updatedChat: ChatConversation = {
          ...existingChat,
          messages: [...existingChat.messages, message],
          updatedAt,
        };

        /*
         * Persist the exchange to the conversation's own history file
         * instead of creating a new file, keeping the same chat ID,
         * thread ID, and project path. The write is idempotent, so
         * StrictMode re-running this updater cannot corrupt anything.
         */
        if (updatedChat.historyFilePath) {
          void saveProjectConversationFile(updatedChat);
        }

        return sortChats(
          currentChats.map((chat) =>
            chat.id === chatId ? updatedChat : chat,
          ),
        );
      });

      return message;
    },
    [],
  );

  const sendUserMessage = useCallback(
    (content: string): AddMessageResult => {
      const normalizedContent = content.trim();

      if (!normalizedContent) {
        throw new Error('The message cannot be empty.');
      }

      if (!activeChatId) {
        return createChat(normalizedContent);
      }

      const message = addMessage(activeChatId, 'user', normalizedContent);

      return {
        chatId: activeChatId,
        message,
      };
    },
    [activeChatId, addMessage, createChat],
  );

  const addAssistantMessage = useCallback(
    (chatId: string, content: string): ChatMessage => {
      return addMessage(chatId, 'assistant', content);
    },
    [addMessage],
  );

  const renameChat = useCallback((chatId: string, title: string) => {
    const normalizedTitle = title.replace(/\s+/g, ' ').trim();

    if (!normalizedTitle) {
      return;
    }

    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              title: normalizedTitle,
              updatedAt: new Date().toISOString(),
            }
          : chat,
      ),
    );
  }, []);

  /*
   * Loads the persisted project conversation for a folder and registers
   * it in the chat state without adding duplicates.
   */
  const loadProjectConversation = useCallback(
    async (projectPath: string): Promise<ChatConversation | null> => {
      const normalizedProjectPath = projectPath.trim();

      if (!normalizedProjectPath) {
        return null;
      }

      const loaded = await loadProjectConversationFile(
        normalizedProjectPath,
      );

      if (!loaded) {
        return null;
      }

      const normalizedLoadedHistoryPath = normalizeHistoryFilePath(
        loaded.historyFilePath,
      );

      /*
       * Register the conversation idempotently: every existing copy
       * with the same chat ID or the same normalized history file is
       * replaced by the loaded data. Concurrent loads of the same
       * folder (for example the folder picker and ensureChat running
       * at the same time) can therefore never leave duplicate
       * conversations in the list.
       */
      setChats((currentChats) => {
        const withoutExisting = currentChats.filter(
          (chat) =>
            chat.id !== loaded.id &&
            !(
              chat.historyFilePath &&
              normalizeHistoryFilePath(chat.historyFilePath) ===
                normalizedLoadedHistoryPath
            ),
        );

        return sortChats([loaded, ...withoutExisting]);
      });

      setActiveChatId(loaded.id);

      return loaded;
    },
    [],
  );

  const ensureChat = useCallback(
    async (
      firstUserMessage: string,
      projectPath = '',
      initialHistory: ChatMessage[] = [],
    ): Promise<EnsureChatResult> => {
      const normalizedMessage = firstUserMessage.trim();

      if (!normalizedMessage) {
        throw new Error('The first message cannot be empty.');
      }

      /*
       * Reuse the already-active conversation. It keeps its chat ID,
       * agent thread ID, project path, and history file path, so new
       * messages are appended to the same conversation and file.
       */
      if (activeChatId) {
        return {
          chatId: activeChatId,
          wasCreated: false,
        };
      }

      const normalizedProjectPath = projectPath.trim();

      /*
       * A selected project folder may already hold a persisted
       * conversation: resume it instead of creating a duplicate.
       */
      if (normalizedProjectPath) {
        const loadedConversation = await loadProjectConversation(
          normalizedProjectPath,
        );

        if (loadedConversation) {
          return {
            chatId: loadedConversation.id,
            wasCreated: false,
          };
        }
      }

      /*
       * No active chat and no persisted project history: create a new
       * conversation (and its history file for project chats).
       */
      const { chatId } = createChat(
        normalizedMessage,
        normalizedProjectPath,
        initialHistory,
      );

      return {
        chatId,
        wasCreated: true,
      };
    },
    [activeChatId, createChat, loadProjectConversation],
  );

  const appendMessage = useCallback(
    (chatId: string, role: ChatRole, content: string): ChatMessage =>
      addMessage(chatId, role, content),
    [addMessage],
  );

  const updateChatProjectPath = useCallback(
    (chatId: string, projectPath: string) => {
      const normalizedPath = projectPath.trim();

      setChats((currentChats) =>
        currentChats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                projectPath: normalizedPath,
                historyFilePath: normalizedPath
                  ? getProjectHistoryFilePath(normalizedPath)
                  : '',
              }
            : chat,
        ),
      );
    },
    [],
  );

  const deleteChat = useCallback(
    (chatId: string) => {
      setChats((currentChats) =>
        currentChats.filter((chat) => chat.id !== chatId),
      );

      if (activeChatId === chatId) {
        setActiveChatId(null);
      }
    },
    [activeChatId],
  );

  const clearAllChats = useCallback(() => {
    setChats([]);
    setActiveChatId(null);
  }, []);

  return {
    chats,
    activeChat,
    activeChatId,
    recentChats,
    startNewChat,
    selectChat,
    createChat,
    ensureChat,
    loadProjectConversation,
    appendMessage,
    sendUserMessage,
    addMessage,
    addAssistantMessage,
    renameChat,
    updateChatProjectPath,
    deleteChat,
    clearAllChats,
  };
}