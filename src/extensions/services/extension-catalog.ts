import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { parseExtensionApp } from "./extension-apps";

import type {
  ExtensionCommand,
  ExtensionRuntime,
  ExtensionApp,
} from "../types/extension";

export interface CatalogFile {
  path: string;
  content: string;
}

/** A bundled extension discovered from app-data/extensions-default. */
export interface ExtensionCatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  runtime: ExtensionRuntime;
  entry: string;
  author: string;
  tags: string[];
  commands: ExtensionCommand[];
  app?: ExtensionApp;
  sourcePath: string;
}
function isRuntime(value: unknown): value is ExtensionRuntime {
  return value === "node" || value === "python";
}

/**
 * Read the installable extensions directly from the copied extensions-default
 * directory. This keeps the Browse list in sync with files shipped in
 * install-resources/extensions-default instead of a separately embedded catalog.
 */
export async function loadInstallableExtensions(): Promise<ExtensionCatalogEntry[]> {
  const appDataPath = await appDataDir();
  const directories = await readDir("extensions-default", {
    baseDir: BaseDirectory.AppData,
  });
  const extensions: ExtensionCatalogEntry[] = [];

  for (const directory of directories) {
    if (!directory.isDirectory) continue;

    const manifestRelativePath = `extensions-default/${directory.name}/manifest.json`;
    if (!(await exists(manifestRelativePath, { baseDir: BaseDirectory.AppData }))) {
      continue;
    }

    try {
      const manifestText = await readTextFile(manifestRelativePath, { baseDir: BaseDirectory.AppData });
      const value: unknown = JSON.parse(manifestText.replace(/^\uFEFF/, ""));
      if (!value || typeof value !== "object") continue;
      const manifest = value as Record<string, unknown>;
      if (
        typeof manifest.id !== "string" || !manifest.id.trim() ||
        typeof manifest.name !== "string" || !manifest.name.trim() ||
        typeof manifest.description !== "string" ||
        typeof manifest.version !== "string" ||
        typeof manifest.entry !== "string" || !manifest.entry.trim() ||
        !isRuntime(manifest.runtime)
      ) {
        console.warn(`Skipping invalid bundled extension manifest: ${manifestRelativePath}`);
        continue;
      }

      const commands = Array.isArray(manifest.commands)
        ? manifest.commands.filter((command): command is ExtensionCommand =>
            Boolean(command) && typeof command === "object" &&
            typeof (command as Record<string, unknown>).id === "string" &&
            typeof (command as Record<string, unknown>).title === "string",
          )
        : [];
      const app = parseExtensionApp(manifest.app);

      extensions.push({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        version: manifest.version,
        runtime: manifest.runtime,
        entry: manifest.entry,
        author: typeof manifest.author === "string" ? manifest.author : "Mocu",
        tags: Array.isArray(manifest.tags)
          ? manifest.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        commands,
        app,
        sourcePath: await join(appDataPath, "extensions-default", directory.name),
      });
    } catch (error) {
      console.warn(`Could not read bundled extension '${directory.name}':`, error);
    }
  }

  return extensions.sort((first, second) => first.name.localeCompare(second.name));
}
