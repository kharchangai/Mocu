import {
  FolderOpen,
  Mic,
  Paperclip,
  SendHorizontal,
  Square,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { listAvailableSkills } from '../services/skillService';
import { CommandMenu } from './CommandMenu';
import {
  filterSkills,
  findActiveSlashCommand,
  type ActiveSlashCommand,
} from './skillMention';
import type {
  AvailableSkill,
  SelectedSkill,
} from './skillTypes';
import './ChatInput.css';

export type SendOptions = {
  projectPath: string | null;
  selectedSkills: SelectedSkill[];
};

export type ChatInputProps = {
  value?: string;
  projectPath?: string;
  isLoading?: boolean;
  agentName?: string;
  modelLabel?: string;
  effortLabel?: string;
  onValueChange: (value: string) => void;
  onProjectPathChange?: (path: string) => void;
  onChooseProjectFolder?: () => void | Promise<void>;
  onSend: (
    text: string,
    options: SendOptions,
  ) => void | Promise<void>;
  onStop?: () => void;
};

export function ChatInput({
  value = '',
  projectPath = '',
  isLoading = false,
  agentName = 'Mocu',
  modelLabel = 'Mocu · Standard',
  effortLabel = 'Balanced',
  onValueChange,
  onProjectPathChange = () => undefined,
  onChooseProjectFolder,
  onSend,
  onStop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [isProjectPanelOpen, setIsProjectPanelOpen] =
    useState(false);

  const [availableSkills, setAvailableSkills] = useState<
    AvailableSkill[]
  >([]);

  const [activeCommand, setActiveCommand] =
    useState<ActiveSlashCommand | null>(null);

  const [selectedSkills, setSelectedSkills] = useState<
    SelectedSkill[]
  >([]);

  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(
    null,
  );

  const safeValue = typeof value === 'string' ? value : '';
  const safeProjectPath =
    typeof projectPath === 'string' ? projectPath : '';

  const normalizedProjectPath =
    safeProjectPath.trim().length > 0
      ? safeProjectPath.trim()
      : null;

  const canSend = safeValue.trim().length > 0 && !isLoading;
  const hasProjectPath = normalizedProjectPath !== null;

  /*
   * A bare "/" opens the command menu. Once the user types or selects
   * "/skill", the menu switches to the skill list for the query after
   * the command.
   */
  const commandMenuMode: 'commands' | 'skills' | null =
    activeCommand === null
      ? null
      : activeCommand.command === 'skill'
        ? 'skills'
        : 'commands';

  const activeCommandQuery =
    (activeCommand?.command === 'skill'
      ? activeCommand.query
      : '') ?? '';

  const isCommandMenuOpen =
    activeCommand !== null && !isLoading;

  const filteredSkills = useMemo(() => {
    if (commandMenuMode !== 'skills') {
      return [];
    }

    return filterSkills(
      availableSkills,
      activeCommandQuery,
    );
  }, [commandMenuMode, availableSkills, activeCommandQuery]);

  const loadSkills = useCallback(async () => {
    setIsLoadingSkills(true);
    setSkillsError(null);

    try {
      const skills = await listAvailableSkills(
        normalizedProjectPath,
      );

      setAvailableSkills(skills);
    } catch (error) {
      console.error('Failed to load skills:', error);

      setAvailableSkills([]);
      setSkillsError(
        error instanceof Error
          ? error.message
          : 'Failed to load available skills.',
      );
    } finally {
      setIsLoadingSkills(false);
    }
  }, [normalizedProjectPath]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      180,
    )}px`;
  }, [safeValue]);

  useEffect(() => {
    const menuItemCount =
      commandMenuMode === 'skills'
        ? filteredSkills.length
        : 1;

    if (
      selectedItemIndex >= menuItemCount &&
      menuItemCount > 0
    ) {
      setSelectedItemIndex(menuItemCount - 1);
    }
  }, [filteredSkills.length, selectedItemIndex, commandMenuMode]);

  const updateActiveCommand = (
    nextValue: string,
    caretPosition: number,
  ) => {
    const command = findActiveSlashCommand(
      nextValue,
      caretPosition,
    );

    setActiveCommand(command);
    setSelectedItemIndex(0);
  };

  const closeCommandMenu = () => {
    setActiveCommand(null);
    setSelectedItemIndex(0);
  };

  const setTextareaCaret = (position: number) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;

      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  };

  const handleMessageChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const nextValue = event.target.value;
    const caretPosition = event.target.selectionStart;

    onValueChange(nextValue);
    updateActiveCommand(nextValue, caretPosition);
  };

  const handleTextareaSelection = (
    event: React.SyntheticEvent<HTMLTextAreaElement>,
  ) => {
    const textarea = event.currentTarget;

    updateActiveCommand(
      textarea.value,
      textarea.selectionStart,
    );
  };

  const handleProjectPathChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    onProjectPathChange(event.target.value);
  };

  /*
   * Select the "/skill" command from the bare "/" command menu. This
   * keeps the caret after "/skill " so the menu switches to the skill
   * list and the user can keep typing the query.
   */
  const handleSelectCommand = (command: string) => {
    if (!activeCommand || command !== 'skill') {
      return;
    }

    const textBeforeMention = safeValue.slice(
      0,
      activeCommand.start,
    );

    const textAfterMention = safeValue.slice(activeCommand.end);
    const insertedToken = '/skill ';

    const nextValue =
      textBeforeMention + insertedToken + textAfterMention;

    const nextCaretPosition =
      textBeforeMention.length + insertedToken.length;

    onValueChange(nextValue);
    setActiveCommand({
      start: textBeforeMention.length,
      end: nextCaretPosition,
      command: 'skill',
      query: '',
    });
    setSelectedItemIndex(0);
    setTextareaCaret(nextCaretPosition);
  };

  /*
   * Selecting a skill removes the "/skill <query>" command from the
   * message text and records the skill as a removable tag instead.
   */
  const handleSkillSelect = (skill: AvailableSkill) => {
    if (!activeCommand) {
      return;
    }

    const textBeforeMention = safeValue.slice(
      0,
      activeCommand.start,
    );

    const textAfterMention = safeValue.slice(activeCommand.end);

    const nextValue = textBeforeMention + textAfterMention;

    const alreadySelected = selectedSkills.some(
      (selected) => selected.name === skill.name,
    );

    if (!alreadySelected) {
      setSelectedSkills((currentSkills) => [
        ...currentSkills,
        {
          name: skill.name,
          source: skill.source,
          path: skill.path,
        },
      ]);
    }

    onValueChange(nextValue);
    closeCommandMenu();
    setTextareaCaret(textBeforeMention.length);
  };

  const handleRemoveSkill = (skill: SelectedSkill) => {
    setSelectedSkills((currentSkills) =>
      currentSkills.filter(
        (selected) => selected.name !== skill.name,
      ),
    );
  };

  const handleSend = async () => {
    const message = safeValue.trim();

    if (!message || isLoading) {
      return;
    }

    const skillsToSend = [...selectedSkills];

    closeCommandMenu();
    setSelectedSkills([]);
    onValueChange('');

    try {
      await onSend(message, {
        projectPath: normalizedProjectPath,
        selectedSkills: skillsToSend,
      });
    } catch (error) {
      /*
       * Restore the message and the selected skills when sending fails.
       */
      onValueChange(message);
      setSelectedSkills(skillsToSend);
      throw error;
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (isCommandMenuOpen) {
      const menuItemCount =
        commandMenuMode === 'skills'
          ? filteredSkills.length
          : 1;

      if (event.key === 'ArrowDown') {
        event.preventDefault();

        if (menuItemCount > 0) {
          setSelectedItemIndex((currentIndex) =>
            currentIndex >= menuItemCount - 1
              ? 0
              : currentIndex + 1,
          );
        }

        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();

        if (menuItemCount > 0) {
          setSelectedItemIndex((currentIndex) =>
            currentIndex <= 0
              ? menuItemCount - 1
              : currentIndex - 1,
          );
        }

        return;
      }

      if (
        (event.key === 'Enter' || event.key === 'Tab') &&
        menuItemCount > 0
      ) {
        event.preventDefault();

        if (commandMenuMode === 'skills') {
          const selectedSkill =
            filteredSkills[selectedItemIndex];

          if (selectedSkill) {
            handleSkillSelect(selectedSkill);
          }
        } else {
          handleSelectCommand('skill');
        }

        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandMenu();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();

      if (canSend) {
        void handleSend();
      }
    }
  };

  const handleChooseFolder = async () => {
    if (!onChooseProjectFolder) {
      return;
    }

    await onChooseProjectFolder();
  };

  return (
    <div className="chat-input-shell">
      <div className="chat-input-inner">
        <div className="project-folder-section">
          <button
            type="button"
            className={`project-folder-trigger ${
              hasProjectPath
                ? 'project-folder-trigger--active'
                : ''
            }`}
            onClick={() =>
              setIsProjectPanelOpen((current) => !current)
            }
            aria-expanded={isProjectPanelOpen}
          >
            <FolderOpen size={16} />

            <span>
              {hasProjectPath
                ? 'Project folder connected'
                : 'Project folder'}
            </span>

            <span className="project-folder-optional">
              Optional
            </span>
          </button>

          {isProjectPanelOpen && (
            <div className="project-folder-panel">
              <div className="project-folder-panel-header">
                <div>
                  <h3>Project workspace</h3>

                  <p>
                    Mocu can use this folder for project files,
                    chat memory, and project-related data.
                  </p>
                </div>

                <button
                  type="button"
                  className="project-folder-close-button"
                  onClick={() => setIsProjectPanelOpen(false)}
                  aria-label="Close project folder panel"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="project-folder-controls">
                <input
                  type="text"
                  value={safeProjectPath}
                  onChange={handleProjectPathChange}
                  placeholder="Select or enter a project folder path..."
                  aria-label="Project folder path"
                />

                <button
                  type="button"
                  className="choose-folder-button"
                  onClick={() => void handleChooseFolder()}
                >
                  <FolderOpen size={16} />
                  Choose folder
                </button>
              </div>

              {hasProjectPath && (
                <>
                  <p className="selected-project-path">
                    {safeProjectPath}
                  </p>

                  <p className="project-folder-save-hint">
                    Chats with this folder are saved under Projects
                    in the sidebar.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="chat-composer">
          {isCommandMenuOpen && (
            <CommandMenu
              mode={commandMenuMode ?? 'commands'}
              commandQuery={activeCommandQuery}
              skills={filteredSkills}
              selectedIndex={selectedItemIndex}
              isLoading={isLoadingSkills}
              error={skillsError}
              onSelectCommand={handleSelectCommand}
              onSelectSkill={handleSkillSelect}
              onHover={setSelectedItemIndex}
            />
          )}

          {selectedSkills.length > 0 && (
            <div className="skill-tags-row" aria-label="Selected skills">
              {selectedSkills.map((skill) => (
                <span
                  key={`${skill.source}:${skill.name}`}
                  className="skill-tag"
                  title={skill.name}
                >
                  <span className="skill-tag-name">
                    {skill.source === 'project'
                      ? '📁'
                      : '📦'}{' '}
                    {skill.name}
                  </span>

                  <button
                    type="button"
                    className="skill-tag-remove"
                    onClick={() => handleRemoveSkill(skill)}
                    aria-label={`Remove skill ${skill.name}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={safeValue}
            onChange={handleMessageChange}
            onKeyDown={handleKeyDown}
            onClick={handleTextareaSelection}
            onKeyUp={(event) => {
              if (
                event.key !== 'ArrowUp' &&
                event.key !== 'ArrowDown' &&
                event.key !== 'Enter' &&
                event.key !== 'Escape' &&
                event.key !== 'Tab'
              ) {
                handleTextareaSelection(event);
              }
            }}
            placeholder={`Message ${agentName}`}
            rows={1}
            disabled={isLoading}
            aria-label={`Message ${agentName}`}
            aria-expanded={isCommandMenuOpen}
            aria-controls={
              isCommandMenuOpen
                ? 'command-menu-list'
                : undefined
            }
          />

          <div className="chat-composer-footer">
            <div className="chat-composer-left-actions">
              <button
                type="button"
                className="composer-icon-button"
                aria-label="Attach a file"
              >
                <Paperclip size={18} />
              </button>

              <button
                type="button"
                className="composer-menu-button"
              >
                {modelLabel}
                <span>⌄</span>
              </button>

              <button
                type="button"
                className="composer-menu-button"
              >
                {effortLabel}
                <span>⌄</span>
              </button>
            </div>

            <div className="chat-composer-right-actions">
              <button
                type="button"
                className="composer-icon-button"
                aria-label="Voice input"
              >
                <Mic size={17} />
              </button>

              {isLoading ? (
                <button
                  type="button"
                  className="send-button send-button--stop"
                  onClick={onStop}
                  aria-label="Stop generating"
                >
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  className="send-button"
                  onClick={() => void handleSend()}
                  disabled={!canSend}
                  aria-label="Send message"
                >
                  <SendHorizontal size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="chat-input-disclaimer">
          Type /skill to select a skill. Mocu can make mistakes. Check
          important information.
        </p>
      </div>
    </div>
  );
}