import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
} from "@tauri-apps/plugin-fs";

import { appDataDir, join } from "@tauri-apps/api/path";

import type {
  ExtensionManifest,
  ExtensionRuntime,
  InstalledExtension,
} from "../types/extension";

const EXTENSIONS_DIRECTORY = "extensions";
const MANIFEST_FILE = "manifest.json";

function isRuntime(value: unknown): value is ExtensionRuntime {
  return value === "node" || value === "python";
}

function parseManifest(
  rawContent: string,
  manifestPath: string,
): ExtensionManifest {
  let value: unknown;

  try {
    value = JSON.parse(rawContent);
  } catch {
    throw new Error(`Invalid JSON in manifest: ${manifestPath}`);
  }

  if (!value || typeof value !== "object") {
    throw new Error(`Manifest must be an object: ${manifestPath}`);
  }

  const manifest = value as Record<string, unknown>;

  const requiredStrings = [
    "id",
    "name",
    "description",
    "version",
    "entry",
  ] as const;

  for (const key of requiredStrings) {
    if (
      typeof manifest[key] !== "string" ||
      manifest[key].trim().length === 0
    ) {
      throw new Error(
        `Manifest field '${key}' is required: ${manifestPath}`,
      );
    }
  }

  if (!isRuntime(manifest.runtime)) {
    throw new Error(
      `Manifest runtime must be 'node' or 'python': ${manifestPath}`,
    );
  }

  if ("activationEvents" in manifest) {
    console.warn(
      `Ignoring unsupported activationEvents in ${manifestPath}`,
    );
  }

  return {
    id: manifest.id as string,
    name: manifest.name as string,
    description: manifest.description as string,
    version: manifest.version as string,
    runtime: manifest.runtime,
    entry: manifest.entry as string,
    commands: Array.isArray(manifest.commands)
      ? (manifest.commands as ExtensionManifest["commands"])
      : [],
  };
}

export async function ensureExtensionsDirectory(): Promise<string> {
  const directoryExists = await exists(EXTENSIONS_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  if (!directoryExists) {
    await mkdir(EXTENSIONS_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
  }

  const appDataPath = await appDataDir();

  return join(appDataPath, EXTENSIONS_DIRECTORY);
}

export async function scanInstalledExtensions(): Promise<
  InstalledExtension[]
> {
  const extensionsRoot = await ensureExtensionsDirectory();

  const entries = await readDir(EXTENSIONS_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  const installedExtensions: InstalledExtension[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }

    const relativeManifestPath =
      `${EXTENSIONS_DIRECTORY}/${entry.name}/${MANIFEST_FILE}`;

    const manifestExists = await exists(relativeManifestPath, {
      baseDir: BaseDirectory.AppData,
    });

    if (!manifestExists) {
      console.warn(
        `Extension directory has no manifest.json: ${entry.name}`,
      );
      continue;
    }

    try {
      const content = await readTextFile(relativeManifestPath, {
        baseDir: BaseDirectory.AppData,
      });

      const absoluteExtensionPath = await join(
        extensionsRoot,
        entry.name,
      );

      const absoluteManifestPath = await join(
        absoluteExtensionPath,
        MANIFEST_FILE,
      );

      const manifest = parseManifest(
        content,
        absoluteManifestPath,
      );

      if (manifest.id !== entry.name) {
        console.warn(
          `Extension folder '${entry.name}' differs from manifest ID '${manifest.id}'`,
        );
      }

      installedExtensions.push({
        path: absoluteExtensionPath,
        manifestPath: absoluteManifestPath,
        manifest,
      });
    } catch (error) {
      console.error(
        `Could not load extension '${entry.name}':`,
        error,
      );
    }
  }

  return installedExtensions.sort((first, second) =>
    first.manifest.name.localeCompare(second.manifest.name),
  );
}