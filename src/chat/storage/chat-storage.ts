import { appDataDir } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import type { ChatConversation } from '../types/chat';

const GLOBAL_CHAT_FILE = 'chats.json';
const LEGACY_CHAT_STORAGE_KEY = 'mocu-chat-history-v1';
let globalFilePromise: Promise<{ directory: string; file: string }> | null = null;
let pendingWrite: Promise<void> = Promise.resolve();

function getGlobalFile(): Promise<{ directory: string; file: string }> {
  globalFilePromise ??= appDataDir().then((root) => {
    const separator = root.includes('\\') ? '\\' : '/';
    const directory = `${root.replace(/[\\/]+$/, '')}${separator}chats`;
    return { directory, file: `${directory}${separator}${GLOBAL_CHAT_FILE}` };
  });
  return globalFilePromise;
}

function isChat(value: unknown): value is ChatConversation {
  if (!value || typeof value !== 'object') return false;
  const chat = value as Partial<ChatConversation>;
  return typeof chat.id === 'string' && typeof chat.title === 'string' &&
    Array.isArray(chat.messages) && typeof chat.createdAt === 'string' &&
    typeof chat.updatedAt === 'string' &&
    (chat.projectPath === undefined || typeof chat.projectPath === 'string') &&
    (chat.historyFilePath === undefined || typeof chat.historyFilePath === 'string');
}

function parseChats(value: unknown): ChatConversation[] {
  const list = Array.isArray(value) ? value :
    value && typeof value === 'object' && Array.isArray((value as { chats?: unknown }).chats)
      ? (value as { chats: unknown[] }).chats : [];
  return list.filter(isChat).map((chat) => ({
    ...chat,
    projectPath: chat.projectPath ?? '',
    historyFilePath: chat.historyFilePath ?? '',
  })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Used only once to migrate existing browser data into files. */
export function loadLegacyChats(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(LEGACY_CHAT_STORAGE_KEY);
    return raw ? parseChats(JSON.parse(raw)) : [];
  } catch (error) {
    console.error('[Chat Storage] Failed to read legacy chat history:', error);
    return [];
  }
}

/** Global file contains ordinary chats only; project chats are stored in their project. */
export async function loadChats(): Promise<ChatConversation[]> {
  try {
    const { file } = await getGlobalFile();
    if (!(await exists(file))) return [];
    return parseChats(JSON.parse(await readTextFile(file))).filter(
      (chat) => !chat.projectPath && !chat.historyFilePath,
    );
  } catch (error) {
    console.error('[Chat Storage] Failed to load global chats:', error);
    return [];
  }
}

export async function saveChats(chats: ChatConversation[]): Promise<boolean> {
  const write = pendingWrite.then(async () => {
    const { directory, file } = await getGlobalFile();
    await mkdir(directory, { recursive: true });
    const ordinaryChats = chats.filter((chat) => !chat.projectPath && !chat.historyFilePath);
    await writeTextFile(file, JSON.stringify({ version: 1, chats: ordinaryChats }, null, 2));
  });
  pendingWrite = write.catch((error) => console.error('[Chat Storage] Failed to save global chats:', error));
  try {
    await write;
    return true;
  } catch {
    return false;
  }
}

export function clearLegacyChats(): void {
  try {
    localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY);
  } catch (error) {
    console.error('[Chat Storage] Failed to clear legacy chat history:', error);
  }
}

export async function clearStoredChats(): Promise<void> {
  const { file } = await getGlobalFile();
  if (await exists(file)) await remove(file);
}
