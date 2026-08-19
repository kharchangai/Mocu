import type {
  ProjectSkillFile,
} from '../../types/skill';

type SkillCardProps = {
  skillFile: ProjectSkillFile;
  onOpen: (
    skillFile: ProjectSkillFile,
  ) => void;
};

function getMetadataTags(
  skillFile: ProjectSkillFile,
): string[] {
  const tags =
    skillFile.skill.metadata.tags;

  if (!Array.isArray(tags)) {
    return [];
  }

  return tags.filter(
    (tag): tag is string =>
      typeof tag === 'string',
  );
}

function isSkillEnabled(
  skillFile: ProjectSkillFile,
): boolean {
  return (
    skillFile.skill.metadata.enabled !==
    false
  );
}

export function SkillCard({
  skillFile,
  onOpen,
}: SkillCardProps) {
  const tags =
    getMetadataTags(skillFile);

  const enabled =
    isSkillEnabled(skillFile);

  return (
    <button
      type="button"
      className="skill-card"
      onClick={() =>
        onOpen(skillFile)
      }
      aria-label={`Open ${skillFile.skill.name}`}
    >
      <span className="skill-card-top">
        <span className="skill-card-icon">
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
            <path d="M12 3 14.2 8.1 20 9l-4.2 4.1 1 5.8L12 16.2 7.2 19l1-5.9L4 9l5.8-.9Z" />
            <path d="M9.5 12 11 13.5 14.5 10" />
          </svg>
        </span>

        <span
          className={`skill-card-status ${
            enabled
              ? 'skill-card-status-enabled'
              : ''
          }`}
        >
          {enabled
            ? 'Enabled'
            : 'Disabled'}
        </span>
      </span>

      <span className="skill-card-name">
        {skillFile.skill.name}
      </span>

      <span className="skill-card-description">
        {skillFile.skill.description}
      </span>

      {tags.length > 0 ? (
        <span className="skill-card-tags">
          {tags
            .slice(0, 3)
            .map((tag) => (
              <span
                key={tag}
                className="skill-card-tag"
              >
                {tag}
              </span>
            ))}

          {tags.length > 3 ? (
            <span className="skill-card-tag">
              +{tags.length - 3}
            </span>
          ) : null}
        </span>
      ) : null}

      <span className="skill-card-footer">
        <span>
          {skillFile.directoryName}
        </span>

        <span>
          {skillFile.resources.length}{' '}
          {skillFile.resources.length === 1
            ? 'resource'
            : 'resources'}
        </span>
      </span>
    </button>
  );
}