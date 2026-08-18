// src/chat/services/projectChatHistory.ts

import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

import type {
  ChatConversation,
  ChatMessage,
} from '../types/chat';

/**
 * Persistent chat history for a project folder.
 *
 * A project conversation lives in:
 *   <project-folder>/.mocu/memory/chat.json
 *
 * The file stores the full conversation together with a persistent
 * chat ID so the same chat, thread ID, and file are reused every time
 * the project is reopened.
 */
const PROJECT_MEMORY_DIRECTORY = '.mocu/memory';
const PROJECT_HISTORY_FILE = '.mocu/memory/chat.json';

/*
 * Backward compatibility: before chat.json existed, project history
 * was stored as exchanges in short.json. When chat.json is missing,
 * the legacy exchanges are migrated into a chat.json conversation
 * (short.json itself is left untouched).
 */
const LEGACY_SHORT_MEMORY_FILE = '.mocu/memory/short.json';

const HISTORY_FILE_VERSION = 1;

const MAX_CHAT_TITLE_LENGTH = 48;

export type ProjectHistoryFile = {
  version: number;
  chatId: string;
  title: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type LegacyShortMemoryExchange = {
  id: string;
  userMessage: string;
  agentResponse: string;
  createdAt: string;
};

type LegacyShortMemoryFile = {
  version: number;
  updatedAt: string;
  exchanges: LegacyShortMemoryExchange[];
};

const normalizePath = (path: string): string => {
  return path.trim().replace(/[\\/]+$/, '');
};

const joinAbsolutePath = (
  basePath: string,
  relativePath: string,
): string => {
  const normalizedBasePath = normalizePath(basePath);
  const separator = normalizedBasePath.includes('\\')
    ? '\\'
    : '/';

  return `${normalizedBasePath}${separator}${relativePath.replace(
    /[\\/]/g,
    separator,
  )}`;
};

const getDirectoryOfFilePath = (
  filePath: string,
): string => {
  const index = Math.max(
    filePath.lastIndexOf('/'),
    filePath.lastIndexOf('\\'),
  );

  return index === -1 ? filePath : filePath.slice(0, index);
};

/**
 * Normalizes a history file path so the same file is never registered
 * twice even when path separators or casing differ.
 */
export const normalizeHistoryFilePath = (
  filePath: string,
): string => {
  return filePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
};

export const getProjectMemoryDirectory = (
  projectPath: string,
): string => {
  return joinAbsolutePath(
    normalizePath(projectPath),
    PROJECT_MEMORY_DIRECTORY,
  );
};

/**
 * Returns the history file path used for a project folder.
 * All project conversations for a folder share this single file.
 */
export const getProjectHistoryFilePath = (
  projectPath: string,
): string => {
  return joinAbsolutePath(
    normalizePath(projectPath),
    PROJECT_HISTORY_FILE,
  );
};

function createStableId(prefix: string): string {
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

function createTitleFromMessage(content: string): string {
  const normalizedContent = content.replace(/\s+/g, ' ').trim();

  if (!normalizedContent) {
    return 'New conversation';
  }

  if (normalizedContent.length <= MAX_CHAT_TITLE_LENGTH) {
    return normalizedContent;
  }

  return `${normalizedContent
    .slice(0, MAX_CHAT_TITLE_LENGTH)
    .trim()}...`;
}

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ChatMessage>;

  return (
    typeof candidate.id === 'string' &&
    (candidate.role === 'user' ||
      candidate.role === 'assistant' ||
      candidate.role === 'system') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'string'
  );
};

const isProjectHistoryFile = (
  value: unknown,
): value is ProjectHistoryFile => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ProjectHistoryFile>;

  return (
    candidate.version === HISTORY_FILE_VERSION &&
    typeof candidate.chatId === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.projectPath === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.messages)
  );
};

const isLegacyExchange = (
  value: unknown,
): value is LegacyShortMemoryExchange => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<LegacyShortMemoryExchange>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.userMessage === 'string' &&
    typeof candidate.agentResponse === 'string' &&
    typeof candidate.createdAt === 'string'
  );
};

const readHistoryFile = async (
  filePath: string,
): Promise<ProjectHistoryFile | null> => {
  try {
    const fileExists = await exists(filePath);

    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(filePath);

    if (!content.trim()) {
      return null;
    }

    const parsed: unknown = JSON.parse(content);

    if (!isProjectHistoryFile(parsed)) {
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(
      '[Project History] Failed to read the history file:',
      filePath,
      error,
    );

    return null;
  }
};

const readLegacyShortMemoryFile = async (
  projectPath: string,
): Promise<LegacyShortMemoryFile | null> => {
  try {
    const filePath = joinAbsolutePath(
      normalizePath(projectPath),
      LEGACY_SHORT_MEMORY_FILE,
    );

    const fileExists = await exists(filePath);

    if (!fileExists) {
      return null;
    }

    const content = await readTextFile(filePath);

    if (!content.trim()) {
      return null;
    }

    const parsed: unknown = JSON.parse(content);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as Partial<LegacyShortMemoryFile>).exchanges)
    ) {
      return null;
    }

    return parsed as LegacyShortMemoryFile;
  } catch (error) {
    console.error(
      '[Project History] Failed to read the legacy short memory file:',
      error,
    );

    return null;
  }
};

const exchangesToMessages = (
  exchanges: LegacyShortMemoryExchange[],
): ChatMessage[] => {
  return exchanges.flatMap((exchange) => [
    {
      id: `memo-${exchange.id}-user`,
      role: 'user' as const,
      content: exchange.userMessage,
      createdAt: exchange.createdAt,
    },
    {
      id: `memo-${exchange.id}-assistant`,
      role: 'assistant' as const,
      content: exchange.agentResponse,
      createdAt: exchange.createdAt,
    },
  ]);
};

/**
 * Writes a project conversation to its history file.
 *
 * The conversation keeps its persistent chat ID and history file path;
 * nothing is duplicated or renamed.
 */
export async function saveProjectConversationFile(
  conversation: ChatConversation,
): Promise<void> {
  if (!conversation.historyFilePath) {
    console.error(
      '[Project History] The conversation has no history file path.',
    );

    return;
  }

  try {
    await mkdir(getDirectoryOfFilePath(conversation.historyFilePath), {
      recursive: true,
    });

    const history: ProjectHistoryFile = {
      version: HISTORY_FILE_VERSION,
      chatId: conversation.id,
      title: conversation.title,
      projectPath: conversation.projectPath,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages,
    };

    await writeTextFile(
      conversation.historyFilePath,
      JSON.stringify(history, null, 2),
    );

    console.log(
      `[Project History] Saved conversation ${conversation.id} to ${conversation.historyFilePath}`,
    );
  } catch (error) {
    console.error(
      '[Project History] Failed to save the history file:',
      conversation.historyFilePath,
      error,
    );
  }
}

/**
 * Loads the persisted conversation for a project folder.
 *
 * Returns null when the folder has no .mocu/memory directory, no
 * chat.json history file, and no legacy short.json exchanges.
 */
export async function loadProjectConversationFile(
  projectPath: string,
): Promise<ChatConversation | null> {
  const normalizedProjectPath = normalizePath(projectPath);

  if (!normalizedProjectPath) {
    return null;
  }

  const memoryDirectoryPath = getProjectMemoryDirectory(
    normalizedProjectPath,
  );

  const directoryExists = await exists(memoryDirectoryPath);

  if (!directoryExists) {
    return null;
  }

  const historyFilePath = getProjectHistoryFilePath(
    normalizedProjectPath,
  );

  /*
   * 1) Primary format: the persistent chat.json conversation.
   */
  const history = await readHistoryFile(historyFilePath);

  if (history) {
    return {
      id: history.chatId,
      title: history.title,
      messages: history.messages.filter(isChatMessage),
      projectPath: normalizedProjectPath,
      historyFilePath,
      createdAt: history.createdAt,
      updatedAt: history.updatedAt,
    };
  }

  /*
   * 2) Backward compatibility: migrate the legacy short.json exchanges
   *    into a chat.json conversation. The chat ID is assigned once and
   *    stored in the new file so it is reused on later visits.
   */
  const legacyFile = await readLegacyShortMemoryFile(
    normalizedProjectPath,
  );

  if (
    legacyFile &&
    Array.isArray(legacyFile.exchanges) &&
    legacyFile.exchanges.length > 0
  ) {
    const exchanges = legacyFile.exchanges.filter(isLegacyExchange);

    if (exchanges.length > 0) {
      const createdAt =
        exchanges[0]?.createdAt ?? new Date().toISOString();
      const updatedAt =
        exchanges[exchanges.length - 1]?.createdAt ?? createdAt;

      const conversation: ChatConversation = {
        id: createStableId('chat'),
        title: createTitleFromMessage(exchanges[0].userMessage),
        messages: exchangesToMessages(exchanges),
        projectPath: normalizedProjectPath,
        historyFilePath,
        createdAt,
        updatedAt,
      };

      /*
       * Persist the migrated conversation so the next visit reads
       * chat.json directly.
       */
      await saveProjectConversationFile(conversation);

      return conversation;
    }
  }

  return null;
}
