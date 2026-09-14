type SkillsEmptyStateProps = {
  hasProject: boolean;
  hasSearchQuery: boolean;
};

export function SkillsEmptyState({
  hasProject,
  hasSearchQuery,
}: SkillsEmptyStateProps) {
  let title = 'No skills yet';

  let description =
    'Create a skill folder containing a SKILL.md file inside .mocu/skills.';

  if (!hasProject) {
    title = 'Select a project folder';

    description =
      'Skills belong to a project. Select a project before viewing or editing its skills.';
  } else if (hasSearchQuery) {
    title = 'No matching skills';

    description =
      'Try searching with a different name, description, directory, or instruction.';
  }

  return (
    <div className="skills-empty-state">
      <span className="skills-empty-icon">
        <svg
          viewBox="0 0 24 24"
          width="25"
          height="25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3 14.2 8.1 20 9l-4.2 4.1 1 5.8L12 16.2 7.2 19l1-5.9L4 9l5.8-.9Z" />
        </svg>
      </span>

      <h2>{title}</h2>

      <p>{description}</p>
    </div>
  );
}