export type SkillSource = 'global';

export type AvailableSkill = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  path: string;
};

export type SelectedSkill = {
  name: string;
  source: SkillSource;
  path: string;
};