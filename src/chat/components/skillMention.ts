import type {
  AvailableSkill,
  SelectedSkill,
} from './skillTypes';

export type ActiveSkillMention = {
  start: number;
  end: number;
  query: string;
};

export function findActiveSkillMention(
  value: string,
  caretPosition: number,
): ActiveSkillMention | null {
  const textBeforeCaret = value.slice(0, caretPosition);
  const match = textBeforeCaret.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);

  if (!match) {
    return null;
  }

  const matchedText = match[0];
  const query = match[2] ?? '';
  const atOffset = matchedText.lastIndexOf('@');
  const start =
    textBeforeCaret.length - matchedText.length + atOffset;

  return {
    start,
    end: caretPosition,
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

  return skills.filter((skill) =>
    skill.name.toLowerCase().startsWith(normalizedQuery),
  );
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

export function getSelectedSkills(
  message: string,
  availableSkills: AvailableSkill[],
): SelectedSkill[] {
  const selectedSkills = new Map<string, SelectedSkill>();
  const mentionPattern =
    /(^|\s)@([a-z0-9]+(?:[-_][a-z0-9]+)*)/gi;

  for (const match of message.matchAll(mentionPattern)) {
    const mentionedName = match[2]?.toLowerCase();

    if (!mentionedName) {
      continue;
    }

    const skill = availableSkills.find(
      (item) => item.name.toLowerCase() === mentionedName,
    );

    if (!skill) {
      continue;
    }

    selectedSkills.set(skill.id, {
      name: skill.name,
      source: skill.source,
      path: skill.path,
    });
  }

  return [...selectedSkills.values()];
}