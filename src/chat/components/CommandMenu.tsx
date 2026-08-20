import { Box, FolderOpen, TerminalSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AvailableSkill } from './skillTypes';

/*
 * The command menu shows the available slash commands while the caret is
 * on a bare "/", then switches to the matching skill list once the user
 * types or selects "/skill".
 */
type CommandMenuProps = {
  mode: 'commands' | 'skills';
  commandQuery: string;
  skills: AvailableSkill[];
  selectedIndex: number;
  isLoading: boolean;
  error: string | null;
  onSelectCommand: (command: string) => void;
  onSelectSkill: (skill: AvailableSkill) => void;
  onHover: (index: number) => void;
};

export function CommandMenu({
  mode,
  commandQuery,
  skills,
  selectedIndex,
  isLoading,
  error,
  onSelectCommand,
  onSelectSkill,
  onHover,
}: CommandMenuProps) {
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedIndex]);

  const isCommandsMode = mode === 'commands';
  const title = isCommandsMode ? 'Commands' : 'Skills';

  return (
    <div
      className="command-menu"
      role="listbox"
      aria-label={title}
    >
      <div className="command-menu-header">
        <span>{title}</span>
        <span className="command-menu-hint">
          ↑↓ Navigate · Enter Select · Esc Close
        </span>
      </div>

      <div className="command-menu-content">
        {isCommandsMode ? (
          <button
            type="button"
            ref={selectedIndex === 0 ? selectedItemRef : null}
            role="option"
            aria-selected={selectedIndex === 0}
            className={`command-menu-command ${selectedIndex === 0 ? 'command-menu-command--selected' : ''}`}
            onMouseEnter={() => onHover(0)}
            onMouseDown={(event) => {
              event.preventDefault();
              onSelectCommand('skill');
            }}
          >
            <span className="command-menu-icon">
              <TerminalSquare size={17} />
            </span>

            <span className="command-menu-information">
              <span className="command-menu-command-name">
                /skill
              </span>

              <span className="command-menu-command-description">
                Select a skill to guide Mocu
              </span>
            </span>
          </button>
        ) : isLoading ? (
          <div className="command-menu-status">
            Loading skills...
          </div>
        ) : error ? (
          <div className="command-menu-status command-menu-status--error">
            {error}
          </div>
        ) : skills.length === 0 ? (
          <div className="command-menu-status">
            {commandQuery.trim() === ''
              ? 'No matching command found'
              : 'No skills match that query'}
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
                className={`command-menu-skill ${isSelected ? 'command-menu-skill--selected' : ''}`}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectSkill(skill);
                }}
              >
                <span className="command-menu-icon">
                  {skill.source === 'project' ? (
                    <FolderOpen size={17} />
                  ) : (
                    <Box size={17} />
                  )}
                </span>

                <span className="command-menu-information">
                  <span className="command-menu-skill-name">
                    {skill.name}
                  </span>

                  {skill.description && (
                    <span className="command-menu-skill-description">
                      {skill.description}
                    </span>
                  )}
                </span>

                <span
                  className={`command-source-badge command-source-badge--${skill.source}`}
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