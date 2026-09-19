/**
 * MCP configuration and secrets persistence.
 *
 * Configurations live in a dedicated store file (mcp.json) and secret
 * material (bearer tokens, secret headers, secret env values) lives in a
 * separate store file (mcp-secrets.json), mirroring how Mocu keeps API keys
 * in its settings store rather than in ordinary configuration.
 *
 * The Tauri store plugin is imported lazily so this module can be loaded
 * (and unit-tested) in plain Node; tests can also inject an in-memory
 * backend via configureMcpStorage.
 */

import type { McpServerConfig, McpServerSecrets } from './types';

export interface McpStorageBackend {
  listConfigs(): Promise<McpServerConfig[]>;
  getConfig(serverId: string): Promise<McpServerConfig | null>;
  saveConfig(config: McpServerConfig): Promise<void>;
  deleteConfig(serverId: string): Promise<void>;
  getSecrets(serverId: string): Promise<McpServerSecrets>;
  saveSecrets(serverId: string, secrets: McpServerSecrets): Promise<void>;
  deleteSecrets(serverId: string): Promise<void>;
}

let backend: McpStorageBackend | null = null;

/** Replaces the storage backend (used by tests). */
export function configureMcpStorage(
  next: McpStorageBackend,
): void {
  backend = next;
}

function getBackend(): McpStorageBackend {
  backend ||= createTauriStorageBackend();
  return backend;
}

type LazyStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<boolean | void>;
  delete(key: string): Promise<boolean | void>;
  keys(): Promise<string[]>;
  save(): Promise<void>;
};

async function loadStoreFile(fileName: string): Promise<LazyStore> {
  const { load } = await import('@tauri-apps/plugin-store');
  const store = await load(fileName, { defaults: {}, autoSave: false });

  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    keys: () => store.keys(),
    save: () => store.save(),
  };
}

function createTauriStorageBackend(): McpStorageBackend {
  const configKey = (serverId: string) => `mcp:${serverId}`;
  const secretsKey = (serverId: string) => `secret:${serverId}`;

  // The noop catch marks memoized store loads as handled so a failure while
  // nothing awaits them (e.g. tests) is not an unhandled rejection.
  const configStorePromise: Promise<LazyStore> = loadStoreFile('mcp.json');
  const secretsStorePromise: Promise<LazyStore> = loadStoreFile('mcp-secrets.json');
  void configStorePromise.catch(() => undefined);
  void secretsStorePromise.catch(() => undefined);

  return {
    async listConfigs() {
      const store = await configStorePromise;
      const keys = (await store.keys()).filter((key) => key.startsWith('mcp:'));

      const configs: McpServerConfig[] = [];
      for (const key of keys) {
        const value = await store.get<McpServerConfig>(key);
        if (value && typeof value === 'object' && typeof value.id === 'string') {
          configs.push(value);
        }
      }

      return configs.sort((first, second) => first.id.localeCompare(second.id));
    },

    async getConfig(serverId) {
      const store = await configStorePromise;
      const value = await store.get<McpServerConfig>(configKey(serverId));
      return value ?? null;
    },

    async saveConfig(config) {
      const store = await configStorePromise;
      await store.set(configKey(config.id), config);
      await store.save();
    },

    async deleteConfig(serverId) {
      const store = await configStorePromise;
      await store.delete(configKey(serverId));
      await store.save();
    },

    async getSecrets(serverId) {
      const store = await secretsStorePromise;
      const value = await store.get<McpServerSecrets>(secretsKey(serverId));
      return value ?? {};
    },

    async saveSecrets(serverId, secrets) {
      const store = await secretsStorePromise;
      await store.set(secretsKey(serverId), secrets);
      await store.save();
    },

    async deleteSecrets(serverId) {
      const store = await secretsStorePromise;
      await store.delete(secretsKey(serverId));
      await store.save();
    },
  };
}

export async function listStoredMcpConfigs(): Promise<McpServerConfig[]> {
  return getBackend().listConfigs();
}

export async function getStoredMcpConfig(
  serverId: string,
): Promise<McpServerConfig | null> {
  return getBackend().getConfig(serverId);
}

export async function saveStoredMcpConfig(
  config: McpServerConfig,
): Promise<void> {
  return getBackend().saveConfig(config);
}

export async function deleteStoredMcpConfig(serverId: string): Promise<void> {
  return getBackend().deleteConfig(serverId);
}

export async function getStoredMcpSecrets(
  serverId: string,
): Promise<McpServerSecrets> {
  return getBackend().getSecrets(serverId);
}

export async function saveStoredMcpSecrets(
  serverId: string,
  secrets: McpServerSecrets,
): Promise<void> {
  return getBackend().saveSecrets(serverId, secrets);
}

export async function deleteStoredMcpSecrets(serverId: string): Promise<void> {
  return getBackend().deleteSecrets(serverId);
}
