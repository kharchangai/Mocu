import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import type { AvailableSkill } from '../components/skillTypes';

type SkillSource = 'global' | 'project';

type SkillMetadata = {
  name?: string;
  description?: string;
};

type DirectoryEntry = Awaited<
  ReturnType<typeof readDir>
>[number];

export async function listAvailableSkills(
  projectPath: string | null,
): Promise<AvailableSkill[]> {
  /*
   * Normalize once at the entry point so a missing, empty, or
   * whitespace-only path can never reach a project-skills read.
   */
  const normalizedProjectPath =
    projectPath?.trim() ?? '';

  const globalSkills = await readGlobalSkills();

  /*
   * Project skills are loaded only when a valid project is actively
   * selected. Otherwise only global skills are used.
   */
  const projectSkills = normalizedProjectPath
    ? await readProjectSkills(normalizedProjectPath)
    : [];

  return mergeSkills(globalSkills, projectSkills);
}

async function readGlobalSkills(): Promise<AvailableSkill[]> {
  const skillsDirectory = 'skills';

  const directoryExists = await exists(skillsDirectory, {
    baseDir: BaseDirectory.AppData,
  });

  if (!directoryExists) {
    await mkdir(skillsDirectory, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });

    return [];
  }

  return readSkillsDirectory(
    skillsDirectory,
    'global',
    BaseDirectory.AppData,
  );
}

async function readProjectSkills(
  projectPath: string,
): Promise<AvailableSkill[]> {
  const normalizedProjectPath = trimTrailingSeparators(
    projectPath.trim(),
  );

  /*
   * Guard clause: without a valid project path, never scan, enumerate,
   * or read a project skills directory.
   */
  if (!normalizedProjectPath) {
    return [];
  }

  const skillsDirectory = joinPath(
    normalizedProjectPath,
    '.mocu',
    'skills',
  );

  const directoryExists = await exists(skillsDirectory);

  if (!directoryExists) {
    await mkdir(skillsDirectory, {
      recursive: true,
    });

    return [];
  }

  return readSkillsDirectory(skillsDirectory, 'project');
}

async function readSkillsDirectory(
  skillsDirectory: string,
  source: SkillSource,
  baseDir?: BaseDirectory,
): Promise<AvailableSkill[]> {
  const entries = await readDir(
    skillsDirectory,
    baseDir === undefined ? undefined : { baseDir },
  );

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory)
      .map((entry) =>
        readSkillEntry(
          skillsDirectory,
          entry,
          source,
          baseDir,
        ),
      ),
  );

  return skills
    .filter(
      (skill): skill is AvailableSkill => skill !== null,
    )
    .sort((first, second) =>
      first.name.localeCompare(second.name),
    );
}

async function readSkillEntry(
  skillsDirectory: string,
  entry: DirectoryEntry,
  source: SkillSource,
  baseDir?: BaseDirectory,
): Promise<AvailableSkill | null> {
  const skillFilePath = joinPath(
    skillsDirectory,
    entry.name,
    'SKILL.md',
  );

  const skillExists = await exists(
    skillFilePath,
    baseDir === undefined ? undefined : { baseDir },
  );

  if (!skillExists) {
    return null;
  }

  try {
    const content = await readTextFile(
      skillFilePath,
      baseDir === undefined ? undefined : { baseDir },
    );

    const metadata = parseSkillFrontmatter(content);
    const skillName = metadata.name?.trim() || entry.name;

    return {
      id: `${source}:${skillName}`,
      name: skillName,
      description: metadata.description?.trim() || '',
      source,
      path: skillFilePath,
    };
  } catch (error) {
    console.error(
      `Failed to read skill file: ${skillFilePath}`,
      error,
    );

    return null;
  }
}

function parseSkillFrontmatter(
  content: string,
): SkillMetadata {
  const normalizedContent = content.replace(/\r\n/g, '\n');

  if (!normalizedContent.startsWith('---\n')) {
    return {};
  }

  const closingDelimiterIndex =
    normalizedContent.indexOf('\n---', 4);

  if (closingDelimiterIndex === -1) {
    return {};
  }

  const frontmatter = normalizedContent.slice(
    4,
    closingDelimiterIndex,
  );

  const metadata: SkillMetadata = {};

  for (const line of frontmatter.split('\n')) {
    const separatorIndex = line.indexOf(':');

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = removeWrappingQuotes(
      line.slice(separatorIndex + 1).trim(),
    );

    if (key === 'name') {
      metadata.name = value;
    }

    if (key === 'description') {
      metadata.description = value;
    }
  }

  return metadata;
}

function removeWrappingQuotes(value: string): string {
  const isDoubleQuoted =
    value.startsWith('"') && value.endsWith('"');

  const isSingleQuoted =
    value.startsWith("'") && value.endsWith("'");

  if (
    value.length >= 2 &&
    (isDoubleQuoted || isSingleQuoted)
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function mergeSkills(
  globalSkills: AvailableSkill[],
  projectSkills: AvailableSkill[],
): AvailableSkill[] {
  const skillsByName = new Map<string, AvailableSkill>();

  for (const skill of globalSkills) {
    skillsByName.set(skill.name.toLowerCase(), skill);
  }

  // Project skill overrides a global skill with the same name.
  for (const skill of projectSkills) {
    skillsByName.set(skill.name.toLowerCase(), skill);
  }

  return Array.from(skillsByName.values()).sort(
    (first, second) => {
      if (first.source !== second.source) {
        return first.source === 'project' ? -1 : 1;
      }

      return first.name.localeCompare(second.name);
    },
  );
}

function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) {
        return trimTrailingSeparators(part);
      }

      return part.replace(/^[/\\]+|[/\\]+$/g, '');
    })
    .join('/');
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[/\\]+$/g, '');
}