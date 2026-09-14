export type SkillInstallTarget =
  | 'global'
  | 'project'
  | 'both';

export type InstallSkillInput = {
  zipPath: string;
  target: SkillInstallTarget;
  projectPath: string | null;
};

export type InstalledSkillResult = {
  skillName: string;
  installedDirectories: string[];
};