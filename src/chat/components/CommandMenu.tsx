import { Box, FolderOpen, Puzzle, TerminalSquare } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AvailableSkill } from './skillTypes';
import type { AvailableExtension } from './extensionTypes';

/*
 * The command menu shows the available slash commands while the caret is
 * on a bare "/", then switches to the matching skill or extension list
 * once the user types or selects "/skill" or "/extension".
 */
type CommandMenuMode = 'commands' | 'skills' | 'extensions';

type CommandMenuProps = {
  mode: CommandMenuMode;
  commandQuery: string;
  skills: AvailableSkill[];
  extensions: AvailableExtension[];
  selectedIndex: number;
  isLoading: boolean;
  error: string | null;
  onSelectCommand: (command: string) => void;
  onSelectSkill: (skill: AvailableSkill) => void;
  onSelectExtension: (extension: AvailableExtension) => void;
  onHover: (index: number) => void;
};

const COMMANDS = [
  {
    command: 'skill',
    name: '/skill',
    description: 'Select a skill to guide Mocu',
  },
  {
    command: 'extension',
    name: '/extension',
    description: 'Run an extension and send its output to Mocu',
  },
] as const;

export function CommandMenu({
  mode,
  commandQuery,
  skills,
  extensions,
  selectedIndex,
  isLoading,
  error,
  onSelectCommand,
  onSelectSkill,
  onSelectExtension,
  onHover,
}: CommandMenuProps) {
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedIndex]);

  const isCommandsMode = mode === 'commands';
  const title = isCommandsMode
    ? 'Commands'
    : mode === 'skills'
      ? 'Skills'
      : 'Extensions';

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
          COMMANDS.map((commandItem, index) => (
            <button
              key={commandItem.command}
              type="button"
              ref={selectedIndex === index ? selectedItemRef : null}
              role="option"
              aria-selected={selectedIndex === index}
              className={`command-menu-command ${selectedIndex === index ? 'command-menu-command--selected' : ''}`}
              onMouseEnter={() => onHover(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelectCommand(commandItem.command);
              }}
            >
              <span className="command-menu-icon">
                {commandItem.command === 'skill' ? (
                  <TerminalSquare size={17} />
                ) : (
                  <Puzzle size={17} />
                )}
              </span>

              <span className="command-menu-information">
                <span className="command-menu-command-name">
                  {commandItem.name}
                </span>

                <span className="command-menu-command-description">
                  {commandItem.description}
                </span>
              </span>
            </button>
          ))
        ) : isLoading ? (
          <div className="command-menu-status">
            Loading...
          </div>
        ) : error ? (
          <div className="command-menu-status command-menu-status--error">
            {error}
          </div>
        ) : mode === 'skills' ? (
          skills.length === 0 ? (
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
          )
        ) : extensions.length === 0 ? (
          <div className="command-menu-status">
            {commandQuery.trim() === ''
              ? 'No matching command found'
              : 'No extensions match that query'}
          </div>
        ) : (
          extensions.map((extension, index) => {
            const isSelected = index === selectedIndex;

            return (
              <button
                key={extension.id}
                ref={isSelected ? selectedItemRef : null}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`command-menu-skill ${isSelected ? 'command-menu-skill--selected' : ''}`}
                onMouseEnter={() => onHover(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelectExtension(extension);
                }}
              >
                <span className="command-menu-icon">
                  <Puzzle size={17} />
                </span>

                <span className="command-menu-information">
                  <span className="command-menu-skill-name">
                    {extension.name}
                  </span>

                  {extension.description && (
                    <span className="command-menu-skill-description">
                      {extension.description}
                    </span>
                  )}
                </span>

                <span className="command-source-badge command-source-badge--global">
                  Extension
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
