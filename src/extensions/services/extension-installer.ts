import JSZip from "jszip";

import {
  appDataDir,
  basename,
  join,
} from "@tauri-apps/api/path";

import {
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
} from "@tauri-apps/plugin-fs";

import { stopExtension } from "./extension-client";

type ArchiveFile = {
  relativePath: string;
  data: Uint8Array;
};

type BundledFile = {
  path: string;
  content: string;
};

type BundledExtension = {
  id: string;
  files: BundledFile[];
};

type PreparedArchive = {
  extensionId: string;
  files: ArchiveFile[];
};

export type InstalledExtensionResult = {
  extensionId: string;
  installedDirectory: string;
  fileCount: number;
};

function removeZipExtension(
  fileName: string,
): string {
  return fileName.replace(
    /\.zip$/i,
    "",
  );
}

function sanitizeExtensionName(
  value: string,
): string {
  const sanitized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!sanitized) {
    throw new Error(
      "The extension does not have a valid name.",
    );
  }

  return sanitized;
}

function normalizeArchivePath(
  archivePath: string,
): string {
  const normalized = archivePath
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");

  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error(
      `Unsafe path found in ZIP: ${archivePath}`,
    );
  }

  const pathParts = normalized.split("/");

  if (
    pathParts.some(
      (part) =>
        part === ".." ||
        part === "",
    )
  ) {
    throw new Error(
      `Unsafe path found in ZIP: ${archivePath}`,
    );
  }

  return normalized;
}

function findCommonRootDirectory(
  filePaths: string[],
): string | null {
  if (filePaths.length === 0) {
    return null;
  }

  const firstParts =
    filePaths[0].split("/");

  if (firstParts.length < 2) {
    return null;
  }

  const firstDirectory =
    firstParts[0];

  const allFilesUseSameDirectory =
    filePaths.every(
      (filePath) =>
        filePath.startsWith(
          `${firstDirectory}/`,
        ),
    );

  return allFilesUseSameDirectory
    ? firstDirectory
    : null;
}

function resolveExtensionId(
  files: ArchiveFile[],
  fallback: string,
): string {
  const manifestFile = files.find(
    (file) =>
      file.relativePath.toLocaleLowerCase() ===
      "manifest.json",
  );

  if (manifestFile) {
    try {
      const decoded = new TextDecoder().decode(
        manifestFile.data,
      );

      const manifest = JSON.parse(decoded) as {
        id?: unknown;
      };

      if (
        typeof manifest?.id === "string" &&
        manifest.id.trim().length > 0
      ) {
        return sanitizeExtensionName(
          manifest.id,
        );
      }
    } catch {
      // Fall back to the zip folder name below.
    }
  }

  return sanitizeExtensionName(fallback);
}

async function prepareFromZip(
  zipPath: string,
): Promise<PreparedArchive> {
  if (
    !zipPath.toLocaleLowerCase().endsWith(
      ".zip",
    )
  ) {
    throw new Error(
      "Only ZIP files can be installed.",
    );
  }

  const zipBytes = await readFile(zipPath);

  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch {
    throw new Error(
      "The selected ZIP file is invalid or corrupted.",
    );
  }

  const zipEntries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      !entry.name.startsWith("__MACOSX/") &&
      !entry.name.endsWith("/.DS_Store"),
  );

  if (zipEntries.length === 0) {
    throw new Error(
      "The selected ZIP file is empty.",
    );
  }

  const normalizedPaths = zipEntries.map(
    (entry) => normalizeArchivePath(entry.name),
  );

  const commonRootDirectory =
    findCommonRootDirectory(normalizedPaths);

  const strippedPaths = normalizedPaths.map(
    (filePath) => {
      if (!commonRootDirectory) {
        return filePath;
      }

      return filePath.slice(
        commonRootDirectory.length + 1,
      );
    },
  );

  const hasManifest = strippedPaths.some(
    (filePath) =>
      filePath.toLocaleLowerCase() ===
      "manifest.json",
  );

  if (!hasManifest) {
    throw new Error(
      "The ZIP must contain manifest.json at its root or inside one top-level folder.",
    );
  }

  const zipFileName = await basename(zipPath);

  const files = await Promise.all(
    zipEntries.map(
      async (
        entry,
        index,
      ): Promise<ArchiveFile> => {
        const relativePath = normalizeArchivePath(
          strippedPaths[index],
        );

        const data = await entry.async(
          "uint8array",
        );

        return {
          relativePath,
          data,
        };
      },
    ),
  );

  return {
    extensionId: resolveExtensionId(
      files,
      commonRootDirectory ||
        removeZipExtension(zipFileName),
    ),
    files,
  };
}

/*
 * Recursively collects every file inside a directory, keeping the path
 * relative to `rootPath`.
 */
async function collectFolderFiles(
  directoryPath: string,
  rootPath: string,
  relativePrefix: string,
  files: ArchiveFile[],
): Promise<void> {
  const entries = await readDir(directoryPath);

  for (const entry of entries) {
    const entryPath = await join(
      directoryPath,
      entry.name,
    );

    const relativePath = relativePrefix
      ? `${relativePrefix}/${entry.name}`
      : entry.name;

    if (entry.isDirectory) {
      await collectFolderFiles(
        entryPath,
        rootPath,
        relativePath,
        files,
      );
    } else {
      const data = await readFile(entryPath);

      files.push({
        relativePath,
        data,
      });
    }
  }
}

async function installFilesIntoDirectory(
  directoryPath: string,
  files: ArchiveFile[],
): Promise<void> {
  if (await exists(directoryPath)) {
    throw new Error(
      `An extension already exists at: ${directoryPath}`,
    );
  }

  await mkdir(directoryPath, {
    recursive: true,
  });

  try {
    for (const file of files) {
      const pathParts =
        file.relativePath.split("/");

      const filePath = await join(
        directoryPath,
        ...pathParts,
      );

      if (pathParts.length > 1) {
        const parentDirectory = await join(
          directoryPath,
          ...pathParts.slice(0, -1),
        );

        await mkdir(parentDirectory, {
          recursive: true,
        });
      }

      await writeFile(
        filePath,
        file.data,
      );
    }
  } catch (error) {
    try {
      await remove(directoryPath, {
        recursive: true,
      });
    } catch {
      // Keep the original installation error.
    }

    throw error;
  }
}

async function getExtensionsRoot(): Promise<string> {
  return await join(
    await appDataDir(),
    "extensions",
  );
}

/**
 * Install an extension from a ZIP archive that contains manifest.json.
 */
export async function installExtensionFromZip(
  zipPath: string,
): Promise<InstalledExtensionResult> {
  const archive = await prepareFromZip(zipPath);

  const extensionsRoot =
    await getExtensionsRoot();

  await mkdir(extensionsRoot, {
    recursive: true,
  });

  const installedDirectory = await join(
    extensionsRoot,
    archive.extensionId,
  );

  await installFilesIntoDirectory(
    installedDirectory,
    archive.files,
  );

  return {
    extensionId: archive.extensionId,
    installedDirectory,
    fileCount: archive.files.length,
  };
}

/**
 * Install an extension from an already-extracted folder that contains a
 * manifest.json at its root.
 */
export async function installExtensionFromFolder(
  folderPath: string,
): Promise<InstalledExtensionResult> {
  const manifestPath = await join(
    folderPath,
    "manifest.json",
  );

  if (!(await exists(manifestPath))) {
    throw new Error(
      "The selected folder does not contain manifest.json.",
    );
  }

  const manifestText =
    await readTextFile(manifestPath);

  let manifestId: string;

  try {
    const parsed = JSON.parse(manifestText) as {
      id?: unknown;
    };

    manifestId = sanitizeExtensionName(
      typeof parsed?.id === "string"
        ? parsed.id
        : await basename(folderPath),
    );
  } catch {
    throw new Error(
      "manifest.json is invalid JSON.",
    );
  }

  const files: ArchiveFile[] = [];

  await collectFolderFiles(
    folderPath,
    folderPath,
    "",
    files,
  );

  const extensionsRoot =
    await getExtensionsRoot();

  await mkdir(extensionsRoot, {
    recursive: true,
  });

  const installedDirectory = await join(
    extensionsRoot,
    manifestId,
  );

  await installFilesIntoDirectory(
    installedDirectory,
    files,
  );

  return {
    extensionId: manifestId,
    installedDirectory,
    fileCount: files.length,
  };
}

/**
 * Install a bundled extension whose file contents are embedded in the
 * frontend catalog. No on-disk source directory is required, so it
 * works identically in development and in a packaged Tauri build.
 */
export async function installBundledExtension(
  bundled: BundledExtension,
): Promise<InstalledExtensionResult> {
  const files: ArchiveFile[] = bundled.files.map((file) => ({
    relativePath: normalizeArchivePath(file.path),
    data: new TextEncoder().encode(file.content),
  }));

  if (files.length === 0) {
    throw new Error(
      "The bundled extension contains no files.",
    );
  }

  const hasManifest = files.some(
    (file) =>
      file.relativePath.toLocaleLowerCase() ===
      "manifest.json",
  );

  if (!hasManifest) {
    throw new Error(
      "The bundled extension must contain manifest.json.",
    );
  }

  const extensionId = sanitizeExtensionName(
    bundled.id,
  );

  const extensionsRoot =
    await getExtensionsRoot();

  await mkdir(extensionsRoot, {
    recursive: true,
  });

  const installedDirectory = await join(
    extensionsRoot,
    extensionId,
  );

  await installFilesIntoDirectory(
    installedDirectory,
    files,
  );

  return {
    extensionId,
    installedDirectory,
    fileCount: files.length,
  };
}

/**
 * Remove an installed extension directory by its ID.
 */
export async function uninstallExtension(
  extensionId: string,
): Promise<void> {
  const safeId = sanitizeExtensionName(extensionId);

  // Stop any running process for this extension first.
  try {
    await stopExtension(safeId);
  } catch (error) {
    console.warn(
      `Failed to stop extension '${safeId}' during uninstall:`, error,
    );
  }

  const extensionsRoot =
    await getExtensionsRoot();

  const installedDirectory = await join(
    extensionsRoot,
    safeId,
  );

  if (!(await exists(installedDirectory))) {
    return;
  }

  await remove(installedDirectory, {
    recursive: true,
  });
}