import JSZip from 'jszip';

import {
  appDataDir,
  basename,
  join,
} from '@tauri-apps/api/path';

import {
  exists,
  mkdir,
  readFile,
  remove,
  writeFile,
} from '@tauri-apps/plugin-fs';

import type {
  InstalledSkillResult,
  InstallSkillInput,
} from '../types/skillInstaller';

type ArchiveFile = {
  relativePath: string;
  data: Uint8Array;
};

type PreparedArchive = {
  skillName: string;
  files: ArchiveFile[];
};

function removeZipExtension(
  fileName: string,
): string {
  return fileName.replace(
    /\.zip$/i,
    '',
  );
}

function sanitizeSkillName(
  value: string,
): string {
  const sanitized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!sanitized) {
    throw new Error(
      'The ZIP file does not have a valid skill name.',
    );
  }

  return sanitized;
}

function normalizeArchivePath(
  archivePath: string,
): string {
  const normalized = archivePath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/');

  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    throw new Error(
      `Unsafe path found in ZIP: ${archivePath}`,
    );
  }

  const pathParts = normalized.split('/');

  if (
    pathParts.some(
      (part) =>
        part === '..' ||
        part === '',
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
    filePaths[0].split('/');

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

async function prepareArchive(
  zipPath: string,
): Promise<PreparedArchive> {
  if (!zipPath.toLocaleLowerCase().endsWith('.zip')) {
    throw new Error(
      'Only ZIP files can be installed.',
    );
  }

  const zipBytes =
    await readFile(zipPath);

  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(
      zipBytes,
    );
  } catch {
    throw new Error(
      'The selected ZIP file is invalid or corrupted.',
    );
  }

  const zipEntries =
    Object.values(zip.files).filter(
      (entry) =>
        !entry.dir &&
        !entry.name.startsWith(
          '__MACOSX/',
        ) &&
        !entry.name.endsWith(
          '/.DS_Store',
        ),
    );

  if (zipEntries.length === 0) {
    throw new Error(
      'The selected ZIP file is empty.',
    );
  }

  const normalizedPaths =
    zipEntries.map(
      (entry) =>
        normalizeArchivePath(
          entry.name,
        ),
    );

  const commonRootDirectory =
    findCommonRootDirectory(
      normalizedPaths,
    );

  const strippedPaths =
    normalizedPaths.map(
      (filePath) => {
        if (!commonRootDirectory) {
          return filePath;
        }

        return filePath.slice(
          commonRootDirectory.length + 1,
        );
      },
    );

  const hasSkillFile =
    strippedPaths.some(
      (filePath) =>
        filePath.toLocaleLowerCase() ===
        'skill.md',
    );

  if (!hasSkillFile) {
    throw new Error(
      'The ZIP must contain SKILL.md at its root or inside one top-level folder.',
    );
  }

  const zipFileName =
    await basename(zipPath);

  const skillName =
    sanitizeSkillName(
      commonRootDirectory ||
        removeZipExtension(
          zipFileName,
        ),
    );

  const files =
    await Promise.all(
      zipEntries.map(
        async (
          entry,
          index,
        ): Promise<ArchiveFile> => {
          const relativePath =
            normalizeArchivePath(
              strippedPaths[index],
            );

          const data =
            await entry.async(
              'uint8array',
            );

          return {
            relativePath,
            data,
          };
        },
      ),
    );

  return {
    skillName,
    files,
  };
}

async function getTargetDirectories(
  input: InstallSkillInput,
  skillName: string,
): Promise<string[]> {
  const directories: string[] = [];

  if (
    input.target === 'global' ||
    input.target === 'both'
  ) {
    const globalSkillsDirectory =
      await join(
        await appDataDir(),
        'skills',
      );

    directories.push(
      await join(
        globalSkillsDirectory,
        skillName,
      ),
    );
  }

  if (
    input.target === 'project' ||
    input.target === 'both'
  ) {
    const normalizedProjectPath =
      input.projectPath?.trim();

    if (!normalizedProjectPath) {
      throw new Error(
        'Select a project before installing a project skill.',
      );
    }

    directories.push(
      await join(
        normalizedProjectPath,
        '.mocu',
        'skills',
        skillName,
      ),
    );
  }

  return directories;
}

async function installFilesIntoDirectory(
  directoryPath: string,
  files: ArchiveFile[],
): Promise<void> {
  if (await exists(directoryPath)) {
    throw new Error(
      `A skill already exists at: ${directoryPath}`,
    );
  }

  await mkdir(directoryPath, {
    recursive: true,
  });

  try {
    for (const file of files) {
      const pathParts =
        file.relativePath.split('/');

      const filePath =
        await join(
          directoryPath,
          ...pathParts,
        );

      if (pathParts.length > 1) {
        const parentDirectory =
          await join(
            directoryPath,
            ...pathParts.slice(0, -1),
          );

        await mkdir(
          parentDirectory,
          {
            recursive: true,
          },
        );
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

export async function installSkillFromZip(
  input: InstallSkillInput,
): Promise<InstalledSkillResult> {
  const preparedArchive =
    await prepareArchive(
      input.zipPath,
    );

  const targetDirectories =
    await getTargetDirectories(
      input,
      preparedArchive.skillName,
    );

  const installedDirectories: string[] =
    [];

  try {
    for (
      const targetDirectory
      of targetDirectories
    ) {
      await installFilesIntoDirectory(
        targetDirectory,
        preparedArchive.files,
      );

      installedDirectories.push(
        targetDirectory,
      );
    }
  } catch (error) {
    /*
     * If "Both" installation partially succeeds,
     * remove the previously installed copy.
     */
    for (
      const installedDirectory
      of installedDirectories
    ) {
      try {
        await remove(
          installedDirectory,
          {
            recursive: true,
          },
        );
      } catch {
        // Keep the original error.
      }
    }

    throw error;
  }

  return {
    skillName:
      preparedArchive.skillName,
    installedDirectories,
  };
}