import {
  useCallback,
  useMemo,
  useState,
} from 'react';

import {
  useProjectSkills,
} from '../../hooks/useProjectSkills';

import {
  installSkillFromZip,
} from '../../services/skillInstaller';

import type {
  ProjectSkillFile,
} from '../../types/skill';

import type {
  SkillInstallTarget,
} from '../../types/skillInstaller';

import {
  NewSkillModal,
} from './NewSkillModal';

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
  metadata:
    | Record<string, unknown>
    | null
    | undefined,
): string {
  if (!metadata) {
    return '';
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return '';
  }
}

function getErrorMessage(
  error: unknown,
  fallbackMessage: string,
): string {
  if (
    error instanceof Error &&
    error.message.trim()
  ) {
    return error.message;
  }

  if (
    typeof error === 'string' &&
    error.trim()
  ) {
    return error;
  }

  return fallbackMessage;
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

  const [
    isNewSkillModalOpen,
    setIsNewSkillModalOpen,
  ] = useState(false);

  const [
    isInstalling,
    setIsInstalling,
  ] = useState(false);

  const [
    installationError,
    setInstallationError,
  ] = useState<string | null>(
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

  const hasProject =
    normalizedProjectPath.length > 0;

  const isProjectSource =
    source === 'project';

  const sourceTitle =
    isProjectSource
      ? 'Project Skills'
      : 'Global Skills';

  const sourceDescription =
    isProjectSource
      ? 'View, install, and edit Agent Skills stored inside the active project.'
      : 'View, install, and edit Agent Skills available globally across Mocu.';

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

  const searchPlaceholder =
    isProjectSource
      ? 'Search project skills...'
      : 'Search global skills...';

  const searchAriaLabel =
    isProjectSource
      ? 'Search project skills'
      : 'Search global skills';

  const reloadLabel =
    isProjectSource
      ? 'Reload project skills'
      : 'Reload global skills';

  const displayedDirectory =
    isProjectSource
      ? normalizedProjectPath
      : skillsDirectory ||
        'BaseDirectory.AppData/skills';

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
      if (isSaving) {
        return;
      }

      setSelectedSkill(null);
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

  const handleOpenNewSkill =
    useCallback((): void => {
      setInstallationError(null);
      setIsNewSkillModalOpen(true);
    }, []);

  const handleCloseNewSkill =
    useCallback((): void => {
      if (isInstalling) {
        return;
      }

      setInstallationError(null);
      setIsNewSkillModalOpen(false);
    }, [isInstalling]);

  const handleInstallSkill =
    useCallback(
      async (
        zipPath: string,
        target: SkillInstallTarget,
      ): Promise<void> => {
        if (
          isInstalling ||
          !zipPath.trim()
        ) {
          return;
        }

        if (
          (target === 'project' ||
            target === 'both') &&
          !hasProject
        ) {
          setInstallationError(
            'Select a project before installing a project skill.',
          );

          return;
        }

        setIsInstalling(true);
        setInstallationError(null);

        try {
          await installSkillFromZip({
            zipPath,
            target,
            projectPath: hasProject
              ? normalizedProjectPath
              : null,
          });

          await reloadSkills();

          setIsNewSkillModalOpen(
            false,
          );
          setInstallationError(null);
        } catch (installError) {
          setInstallationError(
            getErrorMessage(
              installError,
              'The skill could not be installed.',
            ),
          );
        } finally {
          setIsInstalling(false);
        }
      },
      [
        hasProject,
        isInstalling,
        normalizedProjectPath,
        reloadSkills,
      ],
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
          onClick={
            handleOpenNewSkill
          }
          disabled={
            isLoading ||
            isInstalling
          }
          title="Install a new skill from a ZIP file"
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
          {displayedDirectory}
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
            onChange={(event) => {
              setSearchQuery(
                event.target.value,
              );
            }}
            placeholder={
              searchPlaceholder
            }
            disabled={isLoading}
            aria-label={
              searchAriaLabel
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
          disabled={
            isLoading ||
            isInstalling
          }
          title={reloadLabel}
          aria-label={reloadLabel}
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
      isProjectSource &&
      skillsDirectory !==
        normalizedProjectPath ? (
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
            disabled={
              isLoading ||
              isInstalling
            }
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
           * Global skills remain available when
           * no project is selected.
           */
          hasProject={
            hasProject ||
            !isProjectSource
          }
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

      {isNewSkillModalOpen ? (
        <NewSkillModal
          hasProject={hasProject}
          isInstalling={
            isInstalling
          }
          installationError={
            installationError
          }
          onClose={
            handleCloseNewSkill
          }
          onInstall={
            handleInstallSkill
          }
        />
      ) : null}
    </main>
  );
}