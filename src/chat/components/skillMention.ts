import type {
  AvailableSkill,
  SelectedSkill,
} from './skillTypes';

/*
 * An active slash command typed at the caret.
 *
 * Example positions:
 *
 *   "  /skill react" (caret at end)
 *   -> start at "/", end at caret, command "skill", query "react"
 */
export type ActiveSlashCommand = {
  start: number;
  end: number;
  command: string;
  query: string;
};

export function findActiveSlashCommand(
  value: string,
  caretPosition: number,
): ActiveSlashCommand | null {
  const textBeforeCaret = value.slice(0, caretPosition);
  /*
   * Match a forward slash that begins at the start of the input or
   * after whitespace, followed by an optional command token and an
   * optional whitespace-separated query.
   */
  const match = textBeforeCaret.match(
    /(^|\s)\/([a-zA-Z0-9_-]*)(?:\s+(\S*))?$/,
  );

  if (!match) {
    return null;
  }

  const matchedText = match[0];
  const command = match[2] ?? '';
  const query = match[3] ?? '';
  const slashOffset = matchedText.indexOf('/');
  const start =
    textBeforeCaret.length - matchedText.length + slashOffset;

  return {
    start,
    end: caretPosition,
    command,
    query,
  };
}

export function filterSkills(
  skills: AvailableSkill[],
  query: string,
): AvailableSkill[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return skills;
  }

  return skills.filter((skill) => {
    const nameMatch =
      skill.name.toLowerCase().includes(normalizedQuery);

    const description = (skill.description ?? '').trim();
    const descriptionMatch =
      description.length > 0 &&
      description.toLowerCase().includes(normalizedQuery);

    return nameMatch || descriptionMatch;
  });
}

export function sortSkills(
  skills: AvailableSkill[],
): AvailableSkill[] {
  return [...skills].sort((firstSkill, secondSkill) => {
    if (firstSkill.source !== secondSkill.source) {
      return firstSkill.source === 'project' ? -1 : 1;
    }

    return firstSkill.name.localeCompare(secondSkill.name);
  });
}

/**
 * Project skills override global skills with the same name.
 */
export function mergeSkills(
  globalSkills: AvailableSkill[],
  projectSkills: AvailableSkill[],
): AvailableSkill[] {
  const skillsByName = new Map<string, AvailableSkill>();

  for (const skill of globalSkills) {
    skillsByName.set(skill.name.toLowerCase(), skill);
  }

  for (const skill of projectSkills) {
    skillsByName.set(skill.name.toLowerCase(), skill);
  }

  return sortSkills([...skillsByName.values()]);
}

/*
 * The SelectedSkill shape used for selected-skills tags.
 *
 * This re-exports the type so the input layer does not need to import
 * the skill type module directly.
 */
export type { SelectedSkill };