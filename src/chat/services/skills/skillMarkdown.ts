import {
  parse as parseYaml,
  stringify as stringifyYaml,
} from 'yaml';

import type {
  ProjectSkill,
  SkillMetadata,
} from '../../types/skill';

const FRONTMATTER_DELIMITER = '---';

function normalizeLineEndings(
  value: string,
): string {
  return value.replace(/\r\n?/g, '\n');
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function getRequiredString(
  metadata: Record<string, unknown>,
  key: string,
): string {
  const value = metadata[key];

  if (typeof value !== 'string') {
    throw new Error(
      `The required "${key}" metadata must be a string.`,
    );
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    throw new Error(
      `The required "${key}" metadata cannot be empty.`,
    );
  }

  return normalizedValue;
}

/*
 * Separates the YAML frontmatter from the Markdown instructions.
 *
 * A valid SKILL.md starts with:
 *
 * ---
 * name: example-skill
 * description: Example description
 * ---
 *
 * # Instructions
 */
function splitFrontmatter(
  markdown: string,
): {
  yamlContent: string;
  instructions: string;
} {
  const normalizedMarkdown =
    normalizeLineEndings(markdown);

  const lines =
    normalizedMarkdown.split('\n');

  if (
    lines[0]?.trim() !==
    FRONTMATTER_DELIMITER
  ) {
    throw new Error(
      'SKILL.md must start with YAML frontmatter.',
    );
  }

  let closingDelimiterIndex = -1;

  for (
    let index = 1;
    index < lines.length;
    index += 1
  ) {
    if (
      lines[index].trim() ===
      FRONTMATTER_DELIMITER
    ) {
      closingDelimiterIndex = index;
      break;
    }
  }

  if (closingDelimiterIndex === -1) {
    throw new Error(
      'SKILL.md has no closing YAML frontmatter delimiter.',
    );
  }

  const yamlContent = lines
    .slice(1, closingDelimiterIndex)
    .join('\n');

  const instructions = lines
    .slice(closingDelimiterIndex + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');

  return {
    yamlContent,
    instructions,
  };
}

/*
 * Parses one complete SKILL.md document.
 */
export function parseSkillMarkdown(
  markdown: string,
): ProjectSkill {
  const {
    yamlContent,
    instructions,
  } = splitFrontmatter(markdown);

  let parsedMetadata: unknown;

  try {
    parsedMetadata =
      parseYaml(yamlContent);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Invalid YAML frontmatter: ${message}`,
    );
  }

  if (!isPlainObject(parsedMetadata)) {
    throw new Error(
      'The YAML frontmatter must be an object.',
    );
  }

  const name =
    getRequiredString(
      parsedMetadata,
      'name',
    );

  const description =
    getRequiredString(
      parsedMetadata,
      'description',
    );

  /*
   * Keep all optional and custom metadata, but store required fields
   * separately so the editor can display them clearly.
   */
  const {
    name: _name,
    description: _description,
    ...additionalMetadata
  } = parsedMetadata;

  return {
    name,
    description,
    metadata: additionalMetadata,
    instructions,
  };
}

/*
 * Converts additional metadata into editable YAML.
 *
 * Required name and description fields are intentionally excluded.
 */
export function stringifyAdditionalMetadata(
  metadata: SkillMetadata,
): string {
  const keys =
    Object.keys(metadata);

  if (keys.length === 0) {
    return '';
  }

  return stringifyYaml(
    metadata,
    {
      indent: 2,
      lineWidth: 0,
    },
  ).trim();
}

/*
 * Parses additional YAML entered in the editor.
 */
export function parseAdditionalMetadata(
  yamlContent: string,
): SkillMetadata {
  const normalizedContent =
    yamlContent.trim();

  if (!normalizedContent) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed =
      parseYaml(normalizedContent);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Invalid additional metadata YAML: ${message}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      'Additional metadata must be a YAML object.',
    );
  }

  /*
   * name and description must be edited through their dedicated fields.
   */
  const {
    name: _name,
    description: _description,
    ...additionalMetadata
  } = parsed;

  return additionalMetadata;
}

/*
 * Creates the final Agent Skills-compatible SKILL.md document.
 */
export function serializeSkillMarkdown(
  skill: ProjectSkill,
): string {
  const name =
    skill.name.trim();

  const description =
    skill.description.trim();

  if (!name) {
    throw new Error(
      'Skill name is required.',
    );
  }

  if (!description) {
    throw new Error(
      'Skill description is required.',
    );
  }

  /*
   * Required metadata is always written first.
   */
  const completeMetadata: SkillMetadata = {
    name,
    description,
    ...skill.metadata,
  };

  /*
   * Prevent custom metadata from overriding required fields.
   */
  completeMetadata.name = name;
  completeMetadata.description =
    description;

  const yamlContent =
    stringifyYaml(
      completeMetadata,
      {
        indent: 2,
        lineWidth: 0,
      },
    ).trim();

  const instructions =
    normalizeLineEndings(
      skill.instructions,
    ).trim();

  return [
    FRONTMATTER_DELIMITER,
    yamlContent,
    FRONTMATTER_DELIMITER,
    '',
    instructions,
    '',
  ].join('\n');
}