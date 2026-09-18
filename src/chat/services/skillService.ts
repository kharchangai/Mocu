import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
} from '@tauri-apps/plugin-fs';
import type { AvailableSkill } from '../components/skillTypes';

type SkillSource = 'global';

type SkillMetadata = {
  name?: string;
  description?: string;
};

type DirectoryEntry = Awaited<
  ReturnType<typeof readDir>
>[number];

/*
 * Skills are always read from the global folder:
 *
 *   BaseDirectory.AppData/skills
 */
export async function listAvailableSkills(): Promise<AvailableSkill[]> {
  return readGlobalSkills();
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