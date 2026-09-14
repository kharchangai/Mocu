// src/chat/services/shortTermMemory.ts
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { BaseDirectory } from '@tauri-apps/api/path';

export type ShortMemoryExchange = {
  id: string;
  userMessage: string;
  agentResponse: string;
  createdAt: string;
};

export type ShortMemoryFile = {
  version: 1;
  updatedAt: string;
  exchanges: ShortMemoryExchange[];
};

export type SaveShortMemoryInput = {
  userMessage: string;
  agentResponse: string;
  projectPath?: string | null;
};

export type LoadShortMemoryInput = {
  projectPath?: string | null;
};

export type SaveShortMemoryResult = {
  storageType: 'project' | 'app-data';
  memoryFilePath: string;
  exchange: ShortMemoryExchange;
};

const PROJECT_MEMORY_DIRECTORY = '.mocu/memory';
const PROJECT_MEMORY_FILE = '.mocu/memory/short.json';

const APP_DATA_MEMORY_DIRECTORY = 'chat/.mocu/memory';
const APP_DATA_MEMORY_FILE = 'chat/.mocu/memory/short.json';

const createEmptyMemory = (): ShortMemoryFile => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  exchanges: [],
});

const createExchangeId = (): string => {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }

  return `exchange-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const normalizePath = (path: string): string => {
  return path.replace(/[\\/]+$/, '');
};

const joinAbsolutePath = (
  basePath: string,
  relativePath: string,
): string => {
  const normalizedBasePath = normalizePath(basePath);
  const separator = normalizedBasePath.includes('\\') ? '\\' : '/';

  return `${normalizedBasePath}${separator}${relativePath.replace(
    /[\\/]/g,
    separator,
  )}`;
};

const isShortMemoryFile = (
  value: unknown,
): value is ShortMemoryFile => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ShortMemoryFile>;

  return (
    candidate.version === 1 &&
    typeof candidate.updatedAt === 'string' &&
    Array.isArray(candidate.exchanges)
  );
};

const parseMemoryFile = (content: string): ShortMemoryFile => {
  try {
    const parsed: unknown = JSON.parse(content);

    if (isShortMemoryFile(parsed)) {
      return parsed;
    }

    console.warn(
      'The short-term memory file has an invalid structure. A new structure will be used.',
    );

    return createEmptyMemory();
  } catch (error) {
    console.warn(
      'The short-term memory file could not be parsed. A new structure will be used.',
      error,
    );

    return createEmptyMemory();
  }
};

const readProjectMemory = async (
  memoryFilePath: string,
): Promise<ShortMemoryFile> => {
  const fileExists = await exists(memoryFilePath);

  if (!fileExists) {
    return createEmptyMemory();
  }

  const content = await readTextFile(memoryFilePath);

  return parseMemoryFile(content);
};

const readAppDataMemory = async (): Promise<ShortMemoryFile> => {
  const fileExists = await exists(APP_DATA_MEMORY_FILE, {
    baseDir: BaseDirectory.AppData,
  });

  if (!fileExists) {
    return createEmptyMemory();
  }

  const content = await readTextFile(APP_DATA_MEMORY_FILE, {
    baseDir: BaseDirectory.AppData,
  });

  return parseMemoryFile(content);
};

const saveToProjectFolder = async (
  projectPath: string,
  memory: ShortMemoryFile,
): Promise<string> => {
  const memoryDirectoryPath = joinAbsolutePath(
    projectPath,
    PROJECT_MEMORY_DIRECTORY,
  );

  const memoryFilePath = joinAbsolutePath(
    projectPath,
    PROJECT_MEMORY_FILE,
  );

  await mkdir(memoryDirectoryPath, {
    recursive: true,
  });

  await writeTextFile(
    memoryFilePath,
    JSON.stringify(memory, null, 2),
  );

  return memoryFilePath;
};

const saveToAppData = async (
  memory: ShortMemoryFile,
): Promise<string> => {
  await mkdir(APP_DATA_MEMORY_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
    recursive: true,
  });

  await writeTextFile(
    APP_DATA_MEMORY_FILE,
    JSON.stringify(memory, null, 2),
    {
      baseDir: BaseDirectory.AppData,
    },
  );

  return APP_DATA_MEMORY_FILE;
};

/**
 * Loads the short-term memory exchanges for a project.
 *
 * If projectPath is provided, it reads from:
 * <projectPath>/.mocu/memory/short.json
 *
 * Otherwise, it reads from:
 * BaseDirectory.AppData/chat/.mocu/memory/short.json
 *
 * A missing or invalid file returns an empty memory structure.
 */
export async function loadShortTermMemory({
  projectPath,
}: LoadShortMemoryInput): Promise<ShortMemoryFile> {
  const normalizedProjectPath = projectPath?.trim() ?? '';

  if (normalizedProjectPath) {
    const memoryFilePath = joinAbsolutePath(
      normalizedProjectPath,
      PROJECT_MEMORY_FILE,
    );

    return readProjectMemory(memoryFilePath);
  }

  return readAppDataMemory();
}

/**
 * Saves one user message and one agent response as a single exchange.
 *
 * If projectPath is provided, the exchange is saved in:
 * <projectPath>/.mocu/memory/short.json
 *
 * Otherwise, the exchange is saved in:
 * BaseDirectory.AppData/chat/.mocu/memory/short.json
 */
export async function saveShortTermMemory({
  userMessage,
  agentResponse,
  projectPath,
}: SaveShortMemoryInput): Promise<SaveShortMemoryResult> {
  const normalizedUserMessage = userMessage.trim();
  const normalizedAgentResponse = agentResponse.trim();
  const normalizedProjectPath = projectPath?.trim() ?? '';

  if (!normalizedUserMessage) {
    throw new Error(
      'The user message cannot be empty when saving short-term memory.',
    );
  }

  if (!normalizedAgentResponse) {
    throw new Error(
      'The agent response cannot be empty when saving short-term memory.',
    );
  }

  const exchange: ShortMemoryExchange = {
    id: createExchangeId(),
    userMessage: normalizedUserMessage,
    agentResponse: normalizedAgentResponse,
    createdAt: new Date().toISOString(),
  };

  if (normalizedProjectPath) {
    const memoryFilePath = joinAbsolutePath(
      normalizedProjectPath,
      PROJECT_MEMORY_FILE,
    );

    const memory = await readProjectMemory(memoryFilePath);

    memory.exchanges.push(exchange);
    memory.updatedAt = new Date().toISOString();

    const savedFilePath = await saveToProjectFolder(
      normalizedProjectPath,
      memory,
    );

    return {
      storageType: 'project',
      memoryFilePath: savedFilePath,
      exchange,
    };
  }

  const memory = await readAppDataMemory();

  memory.exchanges.push(exchange);
  memory.updatedAt = new Date().toISOString();

  await saveToAppData(memory);

  return {
    storageType: 'app-data',
    memoryFilePath: APP_DATA_MEMORY_FILE,
    exchange,
  };
}