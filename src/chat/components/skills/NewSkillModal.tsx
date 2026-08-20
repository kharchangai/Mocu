import {
  useCallback,
  useEffect,
  useState,
} from 'react';

import {
  basename,
} from '@tauri-apps/api/path';

import {
  open,
} from '@tauri-apps/plugin-dialog';

import type {
  SkillInstallTarget,
} from '../../types/skillInstaller';

type NewSkillModalProps = {
  hasProject: boolean;
  isInstalling: boolean;
  installationError: string | null;
  onClose: () => void;
  onInstall: (
    zipPath: string,
    target: SkillInstallTarget,
  ) => Promise<void>;
};

export function NewSkillModal({
  hasProject,
  isInstalling,
  installationError,
  onClose,
  onInstall,
}: NewSkillModalProps) {
  const [
    zipPath,
    setZipPath,
  ] = useState('');

  const [
    zipName,
    setZipName,
  ] = useState('');

  const [
    target,
    setTarget,
  ] = useState<SkillInstallTarget>(
    hasProject
      ? 'project'
      : 'global',
  );

  useEffect(() => {
    if (
      !hasProject &&
      target !== 'global'
    ) {
      setTarget('global');
    }
  }, [
    hasProject,
    target,
  ]);

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent,
    ): void => {
      if (
        event.key === 'Escape' &&
        !isInstalling
      ) {
        onClose();
      }
    };

    window.addEventListener(
      'keydown',
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        'keydown',
        handleKeyDown,
      );
    };
  }, [
    isInstalling,
    onClose,
  ]);

  const handleChooseZip =
    useCallback(
      async (): Promise<void> => {
        const selectedPath =
          await open({
            multiple: false,
            directory: false,
            title: 'Choose a skill ZIP file',
            filters: [
              {
                name: 'ZIP archive',
                extensions: ['zip'],
              },
            ],
          });

        if (
          !selectedPath ||
          Array.isArray(selectedPath)
        ) {
          return;
        }

        setZipPath(selectedPath);

        setZipName(
          await basename(
            selectedPath,
          ),
        );
      },
      [],
    );

  const handleSubmit =
    useCallback(
      async (
        event:
          React.FormEvent<HTMLFormElement>,
      ): Promise<void> => {
        event.preventDefault();

        if (
          !zipPath ||
          isInstalling
        ) {
          return;
        }

        await onInstall(
          zipPath,
          target,
        );
      },
      [
        isInstalling,
        onInstall,
        target,
        zipPath,
      ],
    );

  return (
    <div
      className="skill-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget &&
          !isInstalling
        ) {
          onClose();
        }
      }}
    >
      <section
        className="new-skill-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-skill-title"
      >
        <header className="new-skill-modal-header">
          <div>
            <p className="skills-page-eyebrow">
              Skill installer
            </p>

            <h2 id="new-skill-title">
              Install new skill
            </h2>

            <p>
              Choose a ZIP archive and select
              where the skill should be installed.
            </p>
          </div>

          <button
            type="button"
            className="skill-modal-close"
            onClick={onClose}
            disabled={isInstalling}
            aria-label="Close"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <form
          className="new-skill-form"
          onSubmit={handleSubmit}
        >
          <div className="new-skill-field">
            <span className="new-skill-label">
              Skill archive
            </span>

            <button
              type="button"
              className="new-skill-file-picker"
              onClick={() => {
                void handleChooseZip();
              }}
              disabled={isInstalling}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 3v12" />
                <path d="m7 8 5-5 5 5" />
                <path d="M5 14v5h14v-5" />
              </svg>

              <span>
                <strong>
                  {zipName ||
                    'Choose ZIP file'}
                </strong>

                <small>
                  {zipPath ||
                    'The archive must contain SKILL.md'}
                </small>
              </span>
            </button>
          </div>

          <fieldset
            className="new-skill-targets"
            disabled={isInstalling}
          >
            <legend>
              Installation location
            </legend>

            <label
              className={
                target === 'global'
                  ? 'new-skill-target selected'
                  : 'new-skill-target'
              }
            >
              <input
                type="radio"
                name="skill-target"
                value="global"
                checked={
                  target === 'global'
                }
                onChange={() =>
                  setTarget('global')
                }
              />

              <span>
                <strong>Global</strong>
                <small>
                  Available across Mocu
                </small>
              </span>
            </label>

            <label
              className={
                target === 'project'
                  ? 'new-skill-target selected'
                  : 'new-skill-target'
              }
              aria-disabled={!hasProject}
            >
              <input
                type="radio"
                name="skill-target"
                value="project"
                checked={
                  target === 'project'
                }
                disabled={!hasProject}
                onChange={() =>
                  setTarget('project')
                }
              />

              <span>
                <strong>Project</strong>
                <small>
                  {hasProject
                    ? 'Only available in the active project'
                    : 'Select a project first'}
                </small>
              </span>
            </label>

            <label
              className={
                target === 'both'
                  ? 'new-skill-target selected'
                  : 'new-skill-target'
              }
              aria-disabled={!hasProject}
            >
              <input
                type="radio"
                name="skill-target"
                value="both"
                checked={
                  target === 'both'
                }
                disabled={!hasProject}
                onChange={() =>
                  setTarget('both')
                }
              />

              <span>
                <strong>Both</strong>
                <small>
                  Install globally and in the project
                </small>
              </span>
            </label>
          </fieldset>

          {installationError ? (
            <div
              className="skills-message skills-message-error"
              role="alert"
            >
              <span>
                {installationError}
              </span>
            </div>
          ) : null}

          <footer className="new-skill-actions">
            <button
              type="button"
              className="new-skill-cancel-button"
              onClick={onClose}
              disabled={isInstalling}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="skill-primary-button"
              disabled={
                !zipPath ||
                isInstalling
              }
            >
              {isInstalling ? (
                <span
                  className="skills-spinner"
                  aria-hidden="true"
                />
              ) : null}

              {isInstalling
                ? 'Installing...'
                : 'Install skill'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}