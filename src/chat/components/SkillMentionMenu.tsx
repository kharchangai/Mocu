import { Box, FolderOpen } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AvailableSkill } from './skillTypes';

type SkillMentionMenuProps = {
  skills: AvailableSkill[];
  selectedIndex: number;
  isLoading: boolean;
  error: string | null;
  onSelect: (skill: AvailableSkill) => void;
  onHover: (index: number) => void;
};

export function SkillMentionMenu({
  skills,
  selectedIndex,
  isLoading,
  error,
  onSelect,
  onHover,
}: SkillMentionMenuProps) {
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedIndex]);

  return (
    <div
      className="skill-mention-menu"
      role="listbox"
      aria-label="Available skills"
    >
      <div className="skill-mention-menu-header">
        <span>Skills</span>
        <span className="skill-mention-menu-hint">
          ↑↓ Navigate · Enter Select · Esc Close
        </span>
      </div>

      <div className="skill-mention-menu-content">
        {isLoading ? (
          <div className="skill-mention-status">
            Loading skills...
          </div>
        ) : error ? (
          <div className="skill-mention-status skill-mention-status--error">
            {error}
          </div>
        ) : skills.length === 0 ? (
          <div className="skill-mention-status">
            No matching skills found
          </div>
        ) : (
          skills.map((skill, index) => {
            const isSelected = index === selectedIndex;

            return (
              <button
                key={skill.id}
                ref={isSelected ? selectedItemRef : null}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`skill-mention-item ${
                  isSelected ? 'skill-mention-item--selected' : ''
                }`}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(skill);
                }}
              >
                <span className="skill-mention-icon">
                  {skill.source === 'project' ? (
                    <FolderOpen size={17} />
                  ) : (
                    <Box size={17} />
                  )}
                </span>

                <span className="skill-mention-information">
                  <span className="skill-mention-name">
                    @{skill.name}
                  </span>

                  {skill.description && (
                    <span className="skill-mention-description">
                      {skill.description}
                    </span>
                  )}
                </span>

                <span
                  className={`skill-source-badge skill-source-badge--${skill.source}`}
                >
                  {skill.source === 'project'
                    ? 'Project'
                    : 'Global'}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}