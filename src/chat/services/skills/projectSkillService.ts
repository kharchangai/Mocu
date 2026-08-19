import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

import {
  join,
} from '@tauri-apps/api/path';

import type {
  InvalidSkillDirectory,
  LoadProjectSkillsResult,
  ProjectSkillDirectoryEntry,
  ProjectSkillFile,
} from '../../types/skill';

import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
} from './skillMarkdown';

const MOCU_DIRECTORY_NAME = '.mocu';
const SKILLS_DIRECTORY_NAME = 'skills';
const SKILL_FILE_NAME = 'SKILL.md';

export type SkillsSource =
  | 'project'
  | 'global';

type ResolvedSkillsDirectory = {
  /*
   * Path passed to Tauri's filesystem functions.
   *
   * Project skills use an absolute path.
   * Global skills use "skills" relative to BaseDirectory.AppData.
   */
  fsPath: string;

  /*
   * Base directory used by Tauri filesystem functions.
   * It is undefined for absolute project paths.
   */
  baseDir?: BaseDirectory;

  /*
   * A readable path for UI and logs.
   */
  displayPath: string;

  source: SkillsSource;
};

/*
 * Returns the correct skills location:
 *
 * Project selected:
 *   <projectPath>/.mocu/skills
 *
 * No project selected:
 *   BaseDirectory.AppData/skills
 */
async function resolveSkillsDirectory(
  projectPath: string | null,
): Promise<ResolvedSkillsDirectory> {
  const normalizedProjectPath =
    projectPath?.trim() ?? '';

  if (normalizedProjectPath) {
    const absoluteProjectSkillsPath =
      await join(
        normalizedProjectPath,
        MOCU_DIRECTORY_NAME,
        SKILLS_DIRECTORY_NAME,
      );

    return {
      fsPath: absoluteProjectSkillsPath,
      displayPath:
        absoluteProjectSkillsPath,
      source: 'project',
    };
  }

  /*
   * Global skills are relative to BaseDirectory.AppData.
   *
   * File operations receive:
   *
   * path: "skills"
   * baseDir: BaseDirectory.AppData
   */
  return {
    fsPath: SKILLS_DIRECTORY_NAME,
    baseDir: BaseDirectory.AppData,
    displayPath:
      'BaseDirectory.AppData/skills',
    source: 'global',
  };
}

function getFsOptions(
  directory: ResolvedSkillsDirectory,
):
  | {
      baseDir: BaseDirectory;
    }
  | undefined {
  if (
    directory.baseDir === undefined
  ) {
    return undefined;
  }

  return {
    baseDir: directory.baseDir,
  };
}

/*
 * Creates the selected skills directory if it does not exist.
 */
async function ensureSkillsDirectory(
  projectPath: string | null,
): Promise<ResolvedSkillsDirectory> {
  const directory =
    await resolveSkillsDirectory(
      projectPath,
    );

  const options =
    getFsOptions(directory);

  const directoryExists =
    await exists(
      directory.fsPath,
      options,
    );

  if (!directoryExists) {
    await mkdir(
      directory.fsPath,
      {
        recursive: true,
        ...(options ?? {}),
      },
    );
  }

  return directory;
}

/*
 * Reads resource files located beside SKILL.md.
 */
async function loadSkillResources(
  skillDirectoryPath: string,
  baseDir?: BaseDirectory,
): Promise<ProjectSkillDirectoryEntry[]> {
  const options =
    baseDir === undefined
      ? undefined
      : { baseDir };

  const entries =
    await readDir(
      skillDirectoryPath,
      options,
    );

  const resources:
    ProjectSkillDirectoryEntry[] = [];

  for (const entry of entries) {
    if (entry.name === SKILL_FILE_NAME) {
      continue;
    }

    const entryPath =
      await join(
        skillDirectoryPath,
        entry.name,
      );

    resources.push({
      name: entry.name,
      path: entryPath,
      kind: entry.isDirectory
        ? 'directory'
        : 'file',
    });
  }

  resources.sort(
    (first, second) => {
      if (first.kind !== second.kind) {
        return first.kind === 'directory'
          ? -1
          : 1;
      }

      return first.name.localeCompare(
        second.name,
        undefined,
        {
          sensitivity: 'base',
        },
      );
    },
  );

  return resources;
}

async function loadSkillDirectory(
  directoryName: string,
  directoryPath: string,
  source: SkillsSource,
  baseDir?: BaseDirectory,
): Promise<ProjectSkillFile> {
  const options =
    baseDir === undefined
      ? undefined
      : { baseDir };

  const skillFilePath =
    await join(
      directoryPath,
      SKILL_FILE_NAME,
    );

  const skillFileExists =
    await exists(
      skillFilePath,
      options,
    );

  if (!skillFileExists) {
    throw new Error(
      `Missing ${SKILL_FILE_NAME}.`,
    );
  }

  const markdown =
    await readTextFile(
      skillFilePath,
      options,
    );

  const skill =
    parseSkillMarkdown(
      markdown,
    );

  const resources =
    await loadSkillResources(
      directoryPath,
      baseDir,
    );

  return {
    skill,
    directoryName,
    directoryPath,
    skillFilePath,
    resources,

    /*
     * These fields require the type changes shown below.
     */
    source,
    baseDir,
  };
}

/*
 * Loads skills from:
 *
 * - project/.mocu/skills when projectPath exists
 * - BaseDirectory.AppData/skills when projectPath is null or empty
 */
export async function loadProjectSkills(
  projectPath: string | null,
): Promise<LoadProjectSkillsResult> {
  const directory =
    await ensureSkillsDirectory(
      projectPath,
    );

  const options =
    getFsOptions(directory);

  const entries =
    await readDir(
      directory.fsPath,
      options,
    );

  const skills: ProjectSkillFile[] = [];

  const invalidSkills:
    InvalidSkillDirectory[] = [];

  for (const entry of entries) {
    /*
     * Every skill must be stored in its own folder.
     */
    if (!entry.isDirectory) {
      continue;
    }

    const skillDirectoryPath =
      await join(
        directory.fsPath,
        entry.name,
      );

    try {
      const skillFile =
        await loadSkillDirectory(
          entry.name,
          skillDirectoryPath,
          directory.source,
          directory.baseDir,
        );

      skills.push(skillFile);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : String(error);

      invalidSkills.push({
        directoryName: entry.name,
        directoryPath:
          skillDirectoryPath,
        reason,
      });

      console.warn(
        `[Skills] Ignoring invalid ${directory.source} skill directory:`,
        entry.name,
        reason,
      );
    }
  }

  skills.sort((first, second) =>
    first.skill.name.localeCompare(
      second.skill.name,
      undefined,
      {
        sensitivity: 'base',
      },
    ),
  );

  invalidSkills.sort(
    (first, second) =>
      first.directoryName.localeCompare(
        second.directoryName,
        undefined,
        {
          sensitivity: 'base',
        },
      ),
  );

  return {
    directoryPath:
      directory.displayPath,
    skills,
    invalidSkills,

    /*
     * Requires the type change below.
     */
    source: directory.source,
  };
}

/*
 * Saves either a project skill or a global skill back to its original
 * SKILL.md file.
 */
export async function saveProjectSkill(
  skillFile: ProjectSkillFile,
): Promise<ProjectSkillFile> {
  const options =
    skillFile.baseDir === undefined
      ? undefined
      : {
          baseDir:
            skillFile.baseDir,
        };

  const skillDirectoryExists =
    await exists(
      skillFile.directoryPath,
      options,
    );

  if (!skillDirectoryExists) {
    throw new Error(
      `The skill directory no longer exists: ${skillFile.directoryPath}`,
    );
  }

  const markdown =
    serializeSkillMarkdown(
      skillFile.skill,
    );

  await writeTextFile(
    skillFile.skillFilePath,
    markdown,
    options,
  );

  const resources =
    await loadSkillResources(
      skillFile.directoryPath,
      skillFile.baseDir,
    );

  return {
    ...skillFile,
    skill: {
      ...skillFile.skill,
      name:
        skillFile.skill.name.trim(),
      description:
        skillFile.skill.description.trim(),
    },
    resources,
  };
}