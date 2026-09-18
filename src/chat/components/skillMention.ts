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
   * optional query. Queries may contain spaces because resource names
   * commonly do (for example, "/skill Code Reviewer"), but they must
   * not contain another "/": a slash always starts a new command, so
   * typing "/skill a /skill b" yields two separate mentions instead of
   * one mention whose query swallows the second slash.
   */
  const match = textBeforeCaret.match(
    /(^|\s)\/([a-zA-Z0-9_-]*)(?:\s+([^/]+?))?$/,
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
  return [...skills].sort((firstSkill, secondSkill) =>
    firstSkill.name.localeCompare(secondSkill.name),
  );
}

/*
 * The SelectedSkill shape used for selected-skills tags.
 *
 * This re-exports the type so the input layer does not need to import
 * the skill type module directly.
 */
export type { SelectedSkill };