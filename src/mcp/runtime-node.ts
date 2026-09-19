/**
 * Node.js implementation of the MCP stdio spawn host.
 *
 * Used by tests and local development scripts. In the packaged Tauri app,
 * process spawning goes through the Rust backend (runtime-tauri.ts); the
 * WebView itself can never spawn child processes.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import type {
  McpStdioProcessHandle,
  McpStdioSpawnHost,
} from './types';

class NodeStdioProcess implements McpStdioProcessHandle {
  constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  async send(message: string): Promise<void> {
    if (!this.child.stdin.writable) {
      throw new Error('MCP server stdin is closed.');
    }
    this.child.stdin.write(`${message}\n`);
  }

  async stop(): Promise<void> {
    if (this.child.exitCode === null) {
      this.child.kill();
    }
  }

  async readStderr(): Promise<string[]> {
    // Node tests observe stderr through the onStderr callback; this buffer
    // exists for API parity with the Rust host.
    return [];
  }
}

/**
 * Minimal safe inherited environment, mirroring the Rust host so tests and
 * the packaged app behave the same way.
 */
export function getNodeSafeInheritedEnv(): Record<string, string> {
  const safeKeys = [
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'WINDIR',
    'PROGRAMFILES', 'PROGRAMDATA', 'HOME', 'USERPROFILE', 'APPDATA',
    'LOCALAPPDATA', 'TMP', 'TEMP', 'LANG', 'TZ', 'TERM', 'NODE_OPTIONS',
    'NO_COLOR',
  ];

  const env: Record<string, string> = {};
  for (const key of safeKeys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export function createNodeStdioSpawnHost(): McpStdioSpawnHost {
  return {
    async start(id, spec, handlers) {
      if (!spec.command.trim()) {
        throw new Error(`MCP server '${id}' has an empty command.`);
      }

      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd || undefined,
        env: {
          ...getNodeSafeInheritedEnv(),
          ...spec.env,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      let stdoutBuffer = '';
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        let newlineIndex = stdoutBuffer.indexOf('\n');

        while (newlineIndex >= 0) {
          const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (line.trim()) {
            handlers.onMessage(line);
          }
          newlineIndex = stdoutBuffer.indexOf('\n');
        }
      });

      let stderrBuffer = '';
      const stderrLines: string[] = [];
      child.stderr.on('data', (chunk: string) => {
        stderrBuffer += chunk;
        let newlineIndex = stderrBuffer.indexOf('\n');

        while (newlineIndex >= 0) {
          const line = stderrBuffer.slice(0, newlineIndex).replace(/\r$/, '');
          stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
          stderrLines.push(line);
          if (stderrLines.length > 200) {
            stderrLines.shift();
          }
          if (line.trim()) {
            handlers.onStderr(line);
          }
          newlineIndex = stderrBuffer.indexOf('\n');
        }
      });

      child.on('exit', () => {
        handlers.onExit();
      });

      child.on('error', (error: Error) => {
        handlers.onStderr(`Failed to start MCP server '${id}': ${error.message}`);
        handlers.onExit();
      });

      return new NodeStdioProcess(child);
    },
  };
}
