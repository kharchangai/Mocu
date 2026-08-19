import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  loadProjectSkills,
  saveProjectSkill,
} from '../services/skills/projectSkillService';

import type {
  InvalidSkillDirectory,
  ProjectSkillFile,
  SkillsSource,
} from '../types/skill';

type UseProjectSkillsResult = {
  skills: ProjectSkillFile[];

  invalidSkills:
    InvalidSkillDirectory[];

  skillsDirectory: string;
  source: SkillsSource;

  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  reloadSkills: () => Promise<void>;

  updateSkill: (
    skillFile: ProjectSkillFile,
  ) => Promise<ProjectSkillFile>;
};

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function useProjectSkills(
  projectPath: string | null,
): UseProjectSkillsResult {
  const [
    skills,
    setSkills,
  ] = useState<ProjectSkillFile[]>([]);

  const [
    invalidSkills,
    setInvalidSkills,
  ] = useState<
    InvalidSkillDirectory[]
  >([]);

  const [
    skillsDirectory,
    setSkillsDirectory,
  ] = useState('');

  const [
    source,
    setSource,
  ] = useState<SkillsSource>(
    projectPath?.trim()
      ? 'project'
      : 'global',
  );

  const [
    isLoading,
    setIsLoading,
  ] = useState(false);

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<string | null>(
    null,
  );

  const reloadSkills =
    useCallback(async () => {
      setIsLoading(true);
      setError(null);

      try {
        /*
         * Null or an empty path is intentional. The service then uses:
         *
         * BaseDirectory.AppData/skills
         */
        const result =
          await loadProjectSkills(
            projectPath,
          );

        setSkills(result.skills);

        setInvalidSkills(
          result.invalidSkills,
        );

        setSkillsDirectory(
          result.directoryPath,
        );

        setSource(result.source);
      } catch (loadError) {
        console.error(
          '[Skills] Failed to load skills:',
          loadError,
        );

        setSkills([]);
        setInvalidSkills([]);

        setError(
          getErrorMessage(
            loadError,
          ),
        );
      } finally {
        setIsLoading(false);
      }
    }, [projectPath]);

  useEffect(() => {
    void reloadSkills();
  }, [reloadSkills]);

  const updateSkill =
    useCallback(
      async (
        skillFile: ProjectSkillFile,
      ): Promise<ProjectSkillFile> => {
        setIsSaving(true);
        setError(null);

        try {
          const savedSkill =
            await saveProjectSkill(
              skillFile,
            );

          setSkills(
            (currentSkills) =>
              currentSkills
                .map(
                  (currentSkill) =>
                    currentSkill
                      .directoryPath ===
                    savedSkill
                      .directoryPath
                      ? savedSkill
                      : currentSkill,
                )
                .sort(
                  (first, second) =>
                    first.skill.name.localeCompare(
                      second.skill.name,
                      undefined,
                      {
                        sensitivity:
                          'base',
                      },
                    ),
                ),
          );

          return savedSkill;
        } catch (saveError) {
          const message =
            getErrorMessage(
              saveError,
            );

          console.error(
            '[Skills] Failed to save skill:',
            saveError,
          );

          setError(message);

          throw saveError;
        } finally {
          setIsSaving(false);
        }
      },
      [],
    );

  return {
    skills,
    invalidSkills,
    skillsDirectory,
    source,
    isLoading,
    isSaving,
    error,
    reloadSkills,
    updateSkill,
  };
}