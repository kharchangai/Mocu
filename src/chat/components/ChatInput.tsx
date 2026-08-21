import {
  FolderOpen,
  Mic,
  Paperclip,
  Puzzle,
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
import { scanInstalledExtensions } from '../../extensions/services/extension-scanner';
import { CommandMenu } from './CommandMenu';
import {
  filterSkills,
  findActiveSlashCommand,
  type ActiveSlashCommand,
} from './skillMention';
import { filterExtensions } from './extensionMention';
import type {
  AvailableSkill,
  SelectedSkill,
} from './skillTypes';
import type {
  AvailableExtension,
  SelectedExtension,
} from './extensionTypes';
import './ChatInput.css';

export type SendOptions = {
  projectPath: string | null;
  selectedSkills: SelectedSkill[];
  selectedExtensions: SelectedExtension[];
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

type CommandMenuMode = 'commands' | 'skills' | 'extensions';

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

  const [availableExtensions, setAvailableExtensions] = useState<
    AvailableExtension[]
  >([]);

  const [activeCommand, setActiveCommand] =
    useState<ActiveSlashCommand | null>(null);

  const [selectedSkills, setSelectedSkills] = useState<
    SelectedSkill[]
  >([]);

  const [selectedExtensions, setSelectedExtensions] = useState<
    SelectedExtension[]
  >([]);

  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(
    null,
  );

  const [isLoadingExtensions, setIsLoadingExtensions] =
    useState(false);
  const [extensionsError, setExtensionsError] = useState<
    string | null
  >(null);

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
   * "/skill" or "/extension", the menu switches to the matching list
   * for the query after the command.
   */
  const commandMenuMode: CommandMenuMode | null =
    activeCommand === null
      ? null
      : activeCommand.command === 'skill'
        ? 'skills'
        : activeCommand.command === 'extension'
          ? 'extensions'
          : 'commands';

  const activeCommandQuery =
    (activeCommand?.command === 'skill' ||
      activeCommand?.command === 'extension'
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

  const filteredExtensions = useMemo(() => {
    if (commandMenuMode !== 'extensions') {
      return [];
    }

    return filterExtensions(
      availableExtensions,
      activeCommandQuery,
    );
  }, [commandMenuMode, availableExtensions, activeCommandQuery]);

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

  const loadExtensions = useCallback(async () => {
    setIsLoadingExtensions(true);
    setExtensionsError(null);

    try {
      const installed = await scanInstalledExtensions();

      setAvailableExtensions(
        installed.map((extension) => ({
          id: extension.manifest.id,
          name: extension.manifest.name,
          description: extension.manifest.description,
          path: extension.path,
          commands: extension.manifest.commands ?? [],
        })),
      );
    } catch (error) {
      console.error('Failed to load extensions:', error);

      setAvailableExtensions([]);
      setExtensionsError(
        error instanceof Error
          ? error.message
          : 'Failed to load available extensions.',
      );
    } finally {
      setIsLoadingExtensions(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

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
        : commandMenuMode === 'extensions'
          ? filteredExtensions.length
          : 2;

    if (
      selectedItemIndex >= menuItemCount &&
      menuItemCount > 0
    ) {
      setSelectedItemIndex(menuItemCount - 1);
    }
  }, [
    filteredSkills.length,
    filteredExtensions.length,
    selectedItemIndex,
    commandMenuMode,
  ]);

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
   * Select the "/skill" or "/extension" command from the bare "/"
   * command menu. This keeps the caret after "/<command> " so the menu
   * switches to the matching list and the user can keep typing.
   */
  const handleSelectCommand = (command: string) => {
    if (!activeCommand || (command !== 'skill' && command !== 'extension')) {
      return;
    }

    const textBeforeMention = safeValue.slice(
      0,
      activeCommand.start,
    );

    const textAfterMention = safeValue.slice(activeCommand.end);
    const insertedToken = `/${command} `;

    const nextValue =
      textBeforeMention + insertedToken + textAfterMention;

    const nextCaretPosition =
      textBeforeMention.length + insertedToken.length;

    onValueChange(nextValue);
    setActiveCommand({
      start: textBeforeMention.length,
      end: nextCaretPosition,
      command,
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

  /*
   * Selecting an extension removes the "/extension <query>" command from
   * the message text and records the extension as a removable tag.
   */
  const handleExtensionSelect = (extension: AvailableExtension) => {
    if (!activeCommand) {
      return;
    }

    const textBeforeMention = safeValue.slice(
      0,
      activeCommand.start,
    );

    const textAfterMention = safeValue.slice(activeCommand.end);

    const nextValue = textBeforeMention + textAfterMention;

    const alreadySelected = selectedExtensions.some(
      (selected) => selected.id === extension.id,
    );

    if (!alreadySelected) {
      setSelectedExtensions((currentExtensions) => [
        ...currentExtensions,
        {
          id: extension.id,
          name: extension.name,
          path: extension.path,
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

  const handleRemoveExtension = (extension: SelectedExtension) => {
    setSelectedExtensions((currentExtensions) =>
      currentExtensions.filter(
        (selected) => selected.id !== extension.id,
      ),
    );
  };

  const handleSend = async () => {
    const message = safeValue.trim();

    if (!message || isLoading) {
      return;
    }

    const skillsToSend = [...selectedSkills];
    const extensionsToSend = [...selectedExtensions];

    closeCommandMenu();
    setSelectedSkills([]);
    setSelectedExtensions([]);
    onValueChange('');

    try {
      await onSend(message, {
        projectPath: normalizedProjectPath,
        selectedSkills: skillsToSend,
        selectedExtensions: extensionsToSend,
      });
    } catch (error) {
      /*
       * Restore the message and the selected skills/extensions when
       * sending fails.
       */
      onValueChange(message);
      setSelectedSkills(skillsToSend);
      setSelectedExtensions(extensionsToSend);
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
          : commandMenuMode === 'extensions'
            ? filteredExtensions.length
            : 2;

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
        } else if (commandMenuMode === 'extensions') {
          const selectedExtension =
            filteredExtensions[selectedItemIndex];

          if (selectedExtension) {
            handleExtensionSelect(selectedExtension);
          }
        } else {
          const commandItem = selectedItemIndex === 0 ? 'skill' : 'extension';

          handleSelectCommand(commandItem);
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

  const loadSuffix =
    commandMenuMode === 'extensions'
      ? {
          isLoading: isLoadingExtensions,
          error: extensionsError,
        }
      : {
          isLoading: isLoadingSkills,
          error: skillsError,
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
              extensions={filteredExtensions}
              selectedIndex={selectedItemIndex}
              isLoading={loadSuffix.isLoading}
              error={loadSuffix.error}
              onSelectCommand={handleSelectCommand}
              onSelectSkill={handleSkillSelect}
              onSelectExtension={handleExtensionSelect}
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

          {selectedExtensions.length > 0 && (
            <div
              className="skill-tags-row"
              aria-label="Selected extensions"
            >
              {selectedExtensions.map((extension) => (
                <span
                  key={`extension:${extension.id}`}
                  className="skill-tag"
                  title={extension.name}
                >
                  <span className="skill-tag-name">
                    <Puzzle size={12} /> {extension.name}
                  </span>

                  <button
                    type="button"
                    className="skill-tag-remove"
                    onClick={() => handleRemoveExtension(extension)}
                    aria-label={`Remove extension ${extension.name}`}
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
          Type /skill to select a skill, or /extension to run an
          extension. Mocu can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}
