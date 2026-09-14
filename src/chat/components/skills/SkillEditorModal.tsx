import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import type {
  ProjectSkill,
  ProjectSkillFile,
} from '../../types/skill';

import {
  parseAdditionalMetadata,
  stringifyAdditionalMetadata,
} from '../../services/skills/skillMarkdown';

type SkillEditorModalProps = {
  skillFile: ProjectSkillFile;
  isSaving: boolean;
  onClose: () => void;
  onSave: (
    skillFile: ProjectSkillFile,
  ) => Promise<void>;
};

function createSkillCopy(
  skill: ProjectSkill,
): ProjectSkill {
  return {
    ...skill,
    metadata: {
      ...skill.metadata,
    },
  };
}

export function SkillEditorModal({
  skillFile,
  isSaving,
  onClose,
  onSave,
}: SkillEditorModalProps) {
  const [
    editedSkill,
    setEditedSkill,
  ] = useState<ProjectSkill>(
    () =>
      createSkillCopy(
        skillFile.skill,
      ),
  );

  const [
    additionalMetadataYaml,
    setAdditionalMetadataYaml,
  ] = useState(() =>
    stringifyAdditionalMetadata(
      skillFile.skill.metadata,
    ),
  );

  const [
    validationError,
    setValidationError,
  ] = useState<string | null>(null);

  const resources =
    useMemo(
      () => skillFile.resources,
      [skillFile.resources],
    );

  useEffect(() => {
    setEditedSkill(
      createSkillCopy(
        skillFile.skill,
      ),
    );

    setAdditionalMetadataYaml(
      stringifyAdditionalMetadata(
        skillFile.skill.metadata,
      ),
    );

    setValidationError(null);
  }, [skillFile]);

  useEffect(() => {
    const handleKeyDown = (
      event: KeyboardEvent,
    ) => {
      if (
        event.key === 'Escape' &&
        !isSaving
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
  }, [isSaving, onClose]);

  const updateField = <
    Key extends keyof ProjectSkill,
  >(
    key: Key,
    value: ProjectSkill[Key],
  ) => {
    setEditedSkill(
      (currentSkill) => ({
        ...currentSkill,
        [key]: value,
      }),
    );
  };

  const handleSave = async () => {
    const name =
      editedSkill.name.trim();

    const description =
      editedSkill.description.trim();

    if (!name) {
      setValidationError(
        'Skill name is required.',
      );
      return;
    }

    if (!description) {
      setValidationError(
        'Skill description is required.',
      );
      return;
    }

    try {
      const additionalMetadata =
        parseAdditionalMetadata(
          additionalMetadataYaml,
        );

      setValidationError(null);

      await onSave({
        ...skillFile,
        skill: {
          ...editedSkill,
          name,
          description,
          metadata:
            additionalMetadata,
        },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      setValidationError(message);
    }
  };

  return (
    <div
      className="skill-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (
          event.target ===
            event.currentTarget &&
          !isSaving
        ) {
          onClose();
        }
      }}
    >
      <section
        className="skill-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-editor-title"
      >
        <header className="skill-modal-header">
          <div>
            <p className="skill-modal-eyebrow">
              Edit SKILL.md
            </p>

            <h2 id="skill-editor-title">
              {skillFile.skill.name}
            </h2>

            <p className="skill-modal-directory">
              {skillFile.directoryName}/SKILL.md
            </p>
          </div>

          <button
            type="button"
            className="skill-modal-close"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close skill editor"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
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
        </header>

        <div className="skill-modal-content">
          <section className="skill-editor-section">
            <div className="skill-editor-section-heading">
              <h3>Required metadata</h3>

              <p>
                Every skill must provide a name and
                description.
              </p>
            </div>

            <label className="skill-form-field">
              <span>Name</span>

              <input
                type="text"
                value={editedSkill.name}
                onChange={(event) =>
                  updateField(
                    'name',
                    event.target.value,
                  )
                }
                placeholder="code-review"
                autoFocus
              />
            </label>

            <label className="skill-form-field">
              <span>Description</span>

              <textarea
                className="skill-description-input"
                value={
                  editedSkill.description
                }
                onChange={(event) =>
                  updateField(
                    'description',
                    event.target.value,
                  )
                }
                placeholder="Describe what this skill does and when the agent should use it."
              />
            </label>
          </section>

          <section className="skill-editor-section">
            <div className="skill-editor-section-heading">
              <h3>Additional metadata</h3>

              <p>
                Optional YAML fields such as version,
                tags, enabled, license, and
                compatibility.
              </p>
            </div>

            <label className="skill-form-field">
              <span>YAML metadata</span>

              <textarea
                className="skill-metadata-input"
                value={
                  additionalMetadataYaml
                }
                onChange={(event) =>
                  setAdditionalMetadataYaml(
                    event.target.value,
                  )
                }
                spellCheck={false}
                placeholder={[
                  'version: 1',
                  'enabled: true',
                  'tags:',
                  '  - code',
                  '  - review',
                ].join('\n')}
              />

              <small>
                Do not add name or description here.
                Use the fields above.
              </small>
            </label>
          </section>

          <section className="skill-editor-section">
            <div className="skill-editor-section-heading">
              <h3>Instructions</h3>

              <p>
                Markdown instructions loaded by the
                agent when this skill is selected.
              </p>
            </div>

            <label className="skill-form-field">
              <span>Markdown content</span>

              <textarea
                className="skill-instructions-input"
                value={
                  editedSkill.instructions
                }
                onChange={(event) =>
                  updateField(
                    'instructions',
                    event.target.value,
                  )
                }
                spellCheck={false}
                placeholder={[
                  '# Skill title',
                  '',
                  'Explain how the agent should perform this task.',
                  '',
                  '## Workflow',
                  '',
                  '1. Inspect the project.',
                  '2. Perform the requested operation.',
                  '3. Verify the result.',
                ].join('\n')}
              />
            </label>
          </section>

          <section className="skill-editor-section">
            <div className="skill-editor-section-heading">
              <h3>Bundled resources</h3>

              <p>
                Files and directories stored beside
                SKILL.md.
              </p>
            </div>

            {resources.length > 0 ? (
              <div className="skill-resources-list">
                {resources.map(
                  (resource) => (
                    <div
                      key={resource.path}
                      className="skill-resource-item"
                    >
                      <span className="skill-resource-icon">
                        {resource.kind ===
                        'directory' ? (
                          <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                          </svg>
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            width="16"
                            height="16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                            <path d="M14 2v6h6" />
                          </svg>
                        )}
                      </span>

                      <span>
                        {resource.name}
                      </span>

                      <small>
                        {resource.kind}
                      </small>
                    </div>
                  ),
                )}
              </div>
            ) : (
              <p className="skill-no-resources">
                This skill does not contain bundled
                resources.
              </p>
            )}
          </section>

          <div className="skill-file-information">
            <div>
              <span>Directory</span>

              <strong>
                {skillFile.directoryName}
              </strong>
            </div>

            <div>
              <span>Main file</span>

              <strong>SKILL.md</strong>
            </div>

            <div>
              <span>Resources</span>

              <strong>
                {resources.length}
              </strong>
            </div>
          </div>

          {validationError ? (
            <p
              className="skill-form-error"
              role="alert"
            >
              {validationError}
            </p>
          ) : null}
        </div>

        <footer className="skill-modal-footer">
          <button
            type="button"
            className="skill-secondary-button"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>

          <button
            type="button"
            className="skill-primary-button"
            onClick={() =>
              void handleSave()
            }
            disabled={isSaving}
          >
            {isSaving
              ? 'Saving...'
              : 'Save SKILL.md'}
          </button>
        </footer>
      </section>
    </div>
  );
}