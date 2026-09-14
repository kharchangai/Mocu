import type {
  BaseDirectory,
} from '@tauri-apps/plugin-fs';

export type SkillsSource =
  | 'project'
  | 'global';

export type SkillMetadataValue =
  unknown;

export type SkillMetadata = Record<
  string,
  SkillMetadataValue
>;

export interface ProjectSkill {
  name: string;
  description: string;
  metadata: SkillMetadata;
  instructions: string;
}

export interface ProjectSkillDirectoryEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
}

export interface ProjectSkillFile {
  skill: ProjectSkill;

  directoryName: string;

  /*
   * Project skills:
   *   absolute path
   *
   * Global skills:
   *   path relative to BaseDirectory.AppData
   */
  directoryPath: string;

  /*
   * Project skills:
   *   absolute path
   *
   * Global skills:
   *   path relative to BaseDirectory.AppData
   */
  skillFilePath: string;

  resources:
    ProjectSkillDirectoryEntry[];

  source: SkillsSource;

  /*
   * Defined only for global skills.
   */
  baseDir?: BaseDirectory;
}

export interface InvalidSkillDirectory {
  directoryName: string;
  directoryPath: string;
  reason: string;
}

export interface LoadProjectSkillsResult {
  directoryPath: string;
  skills: ProjectSkillFile[];

  invalidSkills:
    InvalidSkillDirectory[];

  source: SkillsSource;
}