import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  useProjectSkills,
} from '../../hooks/useProjectSkills';

import type {
  ProjectSkillFile,
} from '../../types/skill';

import {
  SkillCard,
} from './SkillCard';

import {
  SkillEditorModal,
} from './SkillEditorModal';

import {
  SkillsEmptyState,
} from './SkillsEmptyState';

import './skills.css';

type SkillsPageProps = {
  projectPath: string | null;
};

function createSearchableMetadataText(
  metadata: Record<string, unknown>,
): string {
  try {
    return JSON.stringify(metadata);
  } catch {
    return '';
  }
}

export function SkillsPage({
  projectPath,
}: SkillsPageProps) {
  const [
    searchQuery,
    setSearchQuery,
  ] = useState('');

  const [
    selectedSkill,
    setSelectedSkill,
  ] = useState<ProjectSkillFile | null>(
    null,
  );

  const {
    skills,
    invalidSkills,
    skillsDirectory,
    source,
    isLoading,
    isSaving,
    error,
    reloadSkills,
    updateSkill,
  } = useProjectSkills(projectPath);

  const normalizedProjectPath =
    projectPath?.trim() ?? '';

  const isProjectSource =
    source === 'project';

  const sourceTitle =
    isProjectSource
      ? 'Project Skills'
      : 'Global Skills';

  const sourceDescription =
    isProjectSource
      ? 'View and edit Agent Skills stored inside the active project.'
      : 'View and edit Agent Skills available globally across Mocu.';

  const sourceLabel =
    isProjectSource
      ? 'Active project'
      : 'Global skills';

  const loadingLabel =
    isProjectSource
      ? 'Loading project skills...'
      : 'Loading global skills...';

  const skillsAriaLabel =
    isProjectSource
      ? 'Project skills'
      : 'Global skills';

  const filteredSkills =
    useMemo(() => {
      const normalizedSearch =
        searchQuery
          .trim()
          .toLocaleLowerCase();

      if (!normalizedSearch) {
        return skills;
      }

      return skills.filter(
        (skillFile) => {
          const searchableText = [
            skillFile.skill.name,
            skillFile.skill.description,
            skillFile.skill.instructions,
            skillFile.directoryName,
            createSearchableMetadataText(
              skillFile.skill.metadata,
            ),
            ...skillFile.resources.map(
              (resource) =>
                resource.name,
            ),
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase();

          return searchableText.includes(
            normalizedSearch,
          );
        },
      );
    }, [
      searchQuery,
      skills,
    ]);

  const handleClearSearch =
    useCallback((): void => {
      setSearchQuery('');
    }, []);

  const handleReload =
    useCallback((): void => {
      void reloadSkills();
    }, [reloadSkills]);

  const handleOpenSkill =
    useCallback(
      (
        skillFile: ProjectSkillFile,
      ): void => {
        setSelectedSkill(
          skillFile,
        );
      },
      [],
    );

  const handleCloseEditor =
    useCallback((): void => {
      if (!isSaving) {
        setSelectedSkill(null);
      }
    }, [isSaving]);

  const handleSaveSkill =
    useCallback(
      async (
        skillFile: ProjectSkillFile,
      ): Promise<void> => {
        const savedSkill =
          await updateSkill(
            skillFile,
          );

        setSelectedSkill(
          savedSkill,
        );
      },
      [updateSkill],
    );

  return (
    <main className="skills-page">
      <header className="skills-page-header">
        <div>
          <p className="skills-page-eyebrow">
            {isProjectSource
              ? 'Project capabilities'
              : 'Global capabilities'}
          </p>

          <h1>{sourceTitle}</h1>

          <p className="skills-page-subtitle">
            {sourceDescription}
          </p>
        </div>

        <button
          type="button"
          className="skill-primary-button"
          disabled
          title="Skill creation will be added next"
        >
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>

          New skill
        </button>
      </header>

      <div className="skills-project-path">
        <span>{sourceLabel}</span>

        <strong>
          {isProjectSource
            ? normalizedProjectPath
            : skillsDirectory ||
              'BaseDirectory.AppData/skills'}
        </strong>
      </div>

      <div className="skills-toolbar">
        <label className="skills-search">
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
            />

            <path d="m21 21-4.3-4.3" />
          </svg>

          <input
            type="search"
            value={searchQuery}
            onChange={(event) =>
              setSearchQuery(
                event.target.value,
              )
            }
            placeholder={
              isProjectSource
                ? 'Search project skills...'
                : 'Search global skills...'
            }
            disabled={isLoading}
            aria-label={
              isProjectSource
                ? 'Search project skills'
                : 'Search global skills'
            }
          />

          {searchQuery ? (
            <button
              type="button"
              onClick={
                handleClearSearch
              }
              disabled={isLoading}
              aria-label="Clear search"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          ) : null}
        </label>

        <button
          type="button"
          className="skills-refresh-button"
          onClick={handleReload}
          disabled={isLoading}
          title={
            isProjectSource
              ? 'Reload project skills'
              : 'Reload global skills'
          }
          aria-label={
            isProjectSource
              ? 'Reload project skills'
              : 'Reload global skills'
          }
        >
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 11a8 8 0 1 0-2.34 5.66" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>

      {skillsDirectory &&
      (isProjectSource
        ? skillsDirectory !==
          normalizedProjectPath
        : false) ? (
        <p className="skills-directory">
          {skillsDirectory}
        </p>
      ) : null}

      {error ? (
        <div
          className="skills-message skills-message-error"
          role="alert"
        >
          <span>{error}</span>

          <button
            type="button"
            onClick={handleReload}
            disabled={isLoading}
          >
            Try again
          </button>
        </div>
      ) : null}

      {invalidSkills.length > 0 ? (
        <details className="skills-invalid">
          <summary>
            {invalidSkills.length}{' '}
            invalid skill
            {invalidSkills.length === 1
              ? ''
              : 's'}{' '}
            ignored
          </summary>

          <div>
            {invalidSkills.map(
              (invalidSkill) => (
                <p
                  key={
                    invalidSkill.directoryPath
                  }
                >
                  <strong>
                    {
                      invalidSkill.directoryName
                    }
                  </strong>

                  <span>
                    {invalidSkill.reason}
                  </span>
                </p>
              ),
            )}
          </div>
        </details>
      ) : null}

      {isLoading ? (
        <div
          className="skills-loading"
          role="status"
          aria-live="polite"
        >
          <span
            className="skills-spinner"
            aria-hidden="true"
          />

          <p>{loadingLabel}</p>
        </div>
      ) : filteredSkills.length > 0 ? (
        <section
          className="skills-grid"
          aria-label={skillsAriaLabel}
        >
          {filteredSkills.map(
            (skillFile) => (
              <SkillCard
                key={`${skillFile.source}:${skillFile.directoryPath}`}
                skillFile={skillFile}
                onOpen={
                  handleOpenSkill
                }
              />
            ),
          )}
        </section>
      ) : (
        <SkillsEmptyState
          /*
           * Global skills are also a valid source, even when no project
           * folder has been selected. Therefore this must remain true.
           */
          hasProject
          hasSearchQuery={
            Boolean(
              searchQuery.trim(),
            )
          }
        />
      )}

      {selectedSkill ? (
        <SkillEditorModal
          skillFile={selectedSkill}
          isSaving={isSaving}
          onClose={
            handleCloseEditor
          }
          onSave={
            handleSaveSkill
          }
        />
      ) : null}
    </main>
  );
}