/*
 * Filesystem adapter for the pi-style file tools.
 *
 * All tools go through this module so path handling and Tauri calls stay
 * in one place. Uses @tauri-apps/plugin-fs (the app grants read/write/
 * mkdir/exists for all paths in src-tauri/capabilities/default.json).
 */
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { dirname, isAbsolute, normalize } from "@tauri-apps/api/path";

/**
 * Validates and normalizes an absolute path.
 * Rejects empty paths and anything that is not absolute, so the tools
 * can never accidentally operate on the process working directory.
 */
export async function resolveAbsolutePath(
  rawPath: string,
): Promise<string> {
  const trimmed = rawPath.trim();

  if (!trimmed) {
    throw new Error("A non-empty file path is required.");
  }

  if (!(await isAbsolute(trimmed))) {
    throw new Error(
      `Path must be absolute, got: ${trimmed}`,
    );
  }

  return normalize(trimmed);
}

export async function fileExists(filePath: string): Promise<boolean> {
  return exists(filePath);
}

/**
 * UTF-8 byte length of a string (Buffer is not available in the webview).
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export async function readText(
  filePath: string,
): Promise<string> {
  return readTextFile(filePath);
}

/**
 * Writes text to a file, creating parent directories when needed.
 */
export async function writeText(
  filePath: string,
  content: string,
): Promise<void> {
  const parent = await dirname(filePath);

  if (parent && !(await exists(parent))) {
    await mkdir(parent, { recursive: true });
  }

  await writeTextFile(filePath, content);
}

export type DirectoryEntryInfo = {
  name: string;
  path: string;
  isDirectory: boolean;
};

/**
 * Lists one directory level (non-recursive).
 */
export async function listDirectory(
  directoryPath: string,
): Promise<DirectoryEntryInfo[]> {
  const entries = await readDir(directoryPath);

  return entries.map((entry) => ({
    name: entry.name,
    path: `${directoryPath.replace(/[\\/]+$/, "")}/${entry.name}`,
    isDirectory: entry.isDirectory === true,
  }));
}

/**
 * Walks a directory tree recursively and yields file paths.
 *
 * Safety rules:
 * - symlinked directories are never followed
 * - hidden directories (name starts with ".") are skipped
 * - well-known heavy directories (node_modules, target, ...) are skipped
 * - unreadable directories are skipped instead of failing the whole walk
 */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "__pycache__",
]);

export async function* walkFiles(
  rootPath: string,
): AsyncGenerator<{ path: string; name: string }> {
  const stack: string[] = [rootPath];

  while (stack.length > 0) {
    const directory = stack.pop() as string;

    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(directory);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = `${directory.replace(/[\\/]+$/, "")}/${entry.name}`;

      if (entry.isSymlink) {
        continue;
      }

      if (entry.isDirectory) {
        if (
          entry.name.startsWith(".") ||
          SKIPPED_DIRECTORIES.has(entry.name)
        ) {
          continue;
        }
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile) {
        yield { path: entryPath, name: entry.name };
      }
    }
  }
}
