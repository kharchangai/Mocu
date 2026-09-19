/**
 * Tauri implementation of the MCP runtime (packaged app / dev server).
 *
 * - stdio processes are spawned by the trusted Rust backend through the
 *   narrow, validated `mcp_stdio_*` command API; JSON-RPC lines travel as
 *   `mcp://stdio-*` events.
 * - remote transports use the Rust-backed fetch from tauri-plugin-http so
 *   WebView CORS rules never block MCP endpoints.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

import type {
  McpRuntime,
  McpStdioProcessHandle,
  McpStdioSpawnHost,
} from './types';

export function createTauriStdioSpawnHost(): McpStdioSpawnHost {
  return {
    async start(id, spec, handlers) {
      const unlisteners: UnlistenFn[] = [];

      const wrap = (unlisten: UnlistenFn) => unlisteners.push(unlisten);

      wrap(
        await listen<{ id: string; line: string }>('mcp://stdio-out', (event) => {
          if (event.payload.id === id) {
            handlers.onMessage(event.payload.line);
          }
        }),
      );

      wrap(
        await listen<{ id: string; line: string }>('mcp://stdio-stderr', (event) => {
          if (event.payload.id === id) {
            handlers.onStderr(event.payload.line);
          }
        }),
      );

      wrap(
        await listen<{ id: string }>('mcp://stdio-exit', (event) => {
          if (event.payload.id === id) {
            handlers.onExit();
          }
        }),
      );

      try {
        await invoke('mcp_stdio_start', {
          input: {
            id,
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd ?? null,
            env: spec.env,
          },
        });
      } catch (error) {
        for (const unlisten of unlisteners) {
          unlisten();
        }
        throw error instanceof Error ? error : new Error(String(error));
      }

      const handle: McpStdioProcessHandle = {
        send: (message) =>
          invoke('mcp_stdio_send', {
            input: { id, message },
          }) as Promise<void>,
        stop: () =>
          invoke('mcp_stdio_stop', {
            input: { id },
          }) as Promise<void>,
        readStderr: () =>
          invoke('mcp_stdio_stderr', {
            input: { id },
          }) as Promise<string[]>,
      };

      return {
        ...handle,
        stop: async () => {
          for (const unlisten of unlisteners) {
            unlisten();
          }
          await handle.stop();
        },
      };
    },
  };
}

export function createTauriMcpRuntime(): McpRuntime {
  return {
    spawnHost: createTauriStdioSpawnHost(),
    fetchImpl: tauriFetch as unknown as typeof globalThis.fetch,
  };
}
