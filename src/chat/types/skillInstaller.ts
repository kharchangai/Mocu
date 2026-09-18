export type SkillInstallTarget = 'global';

export type InstallSkillInput = {
  zipPath: string;
};

export type InstalledSkillResult = {
  skillName: string;
  installedDirectories: string[];
};