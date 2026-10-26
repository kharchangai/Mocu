import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exists, mkdir, readTextFile, remove, writeTextFile } = vi.hoisted(() => ({
  exists: vi.fn(),
  mkdir: vi.fn(),
  readTextFile: vi.fn(),
  remove: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists,
  mkdir,
  readTextFile,
  remove,
  writeTextFile,
}));

import { saveProjectConversationFile } from './projectChatHistory';
import type { ChatConversation } from '../types/chat';

const conversation = (content: string): ChatConversation => ({
  id: 'chat-1',
  title: 'Test chat',
  messages: [{
    id: `message-${content}`,
    role: 'user',
    content,
    createdAt: '2026-10-26T00:00:00.000Z',
  }],
  projectPath: 'E:/project',
  historyFilePath: 'E:/project/.mocu/memory/chat.json',
  createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
});

describe('project chat history persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdir.mockResolvedValue(undefined);
  });

  it('serializes concurrent writes to the same history file as valid JSON', async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    let fileContent = '';

    writeTextFile.mockImplementation(async (_path: string, content: string) => {
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      await new Promise((resolve) => setTimeout(resolve, 10));
      fileContent = content;
      activeWrites -= 1;
    });

    const results = await Promise.all([
      saveProjectConversationFile(conversation('first')),
      saveProjectConversationFile(conversation('second')),
    ]);

    expect(results).toEqual([true, true]);
    expect(maximumActiveWrites).toBe(1);
    expect(JSON.parse(fileContent).messages[0].content).toBe('second');
  });
});

