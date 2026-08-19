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
import { SkillMentionMenu } from './SkillMentionMenu';
import {
  filterSkills,
  findActiveSkillMention,
  getSelectedSkills,
  type ActiveSkillMention,
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

  const [activeMention, setActiveMention] =
    useState<ActiveSkillMention | null>(null);

  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);
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

  const filteredSkills = useMemo(() => {
    if (!activeMention) {
      return [];
    }

    return filterSkills(availableSkills, activeMention.query);
  }, [activeMention, availableSkills]);

  const isSkillMenuOpen =
    activeMention !== null && !isLoading;

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
    if (
      selectedSkillIndex >= filteredSkills.length &&
      filteredSkills.length > 0
    ) {
      setSelectedSkillIndex(filteredSkills.length - 1);
    }
  }, [filteredSkills.length, selectedSkillIndex]);

  const updateActiveMention = (
    nextValue: string,
    caretPosition: number,
  ) => {
    const mention = findActiveSkillMention(
      nextValue,
      caretPosition,
    );

    setActiveMention(mention);
    setSelectedSkillIndex(0);
  };

  const closeSkillMenu = () => {
    setActiveMention(null);
    setSelectedSkillIndex(0);
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
    updateActiveMention(nextValue, caretPosition);
  };

  const handleTextareaSelection = (
    event: React.SyntheticEvent<HTMLTextAreaElement>,
  ) => {
    const textarea = event.currentTarget;

    updateActiveMention(
      textarea.value,
      textarea.selectionStart,
    );
  };

  const handleProjectPathChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    onProjectPathChange(event.target.value);
  };

  const handleSkillSelect = (skill: AvailableSkill) => {
    if (!activeMention) {
      return;
    }

    const textBeforeMention = safeValue.slice(
      0,
      activeMention.start,
    );

    const textAfterMention = safeValue.slice(activeMention.end);
    const insertedMention = `@${skill.name} `;

    const nextValue =
      textBeforeMention + insertedMention + textAfterMention;

    const nextCaretPosition =
      textBeforeMention.length + insertedMention.length;

    onValueChange(nextValue);
    closeSkillMenu();
    setTextareaCaret(nextCaretPosition);
  };

  const handleSend = async () => {
    const message = safeValue.trim();

    if (!message || isLoading) {
      return;
    }

    const selectedSkills = getSelectedSkills(
      message,
      availableSkills,
    );

    closeSkillMenu();
    onValueChange('');

    try {
      await onSend(message, {
        projectPath: normalizedProjectPath,
        selectedSkills,
      });
    } catch (error) {
      /*
       * Restore the message when sending fails. Remove this block if
       * message restoration is already handled by the parent.
       */
      onValueChange(message);
      throw error;
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (isSkillMenuOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();

        if (filteredSkills.length > 0) {
          setSelectedSkillIndex((currentIndex) =>
            currentIndex >= filteredSkills.length - 1
              ? 0
              : currentIndex + 1,
          );
        }

        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();

        if (filteredSkills.length > 0) {
          setSelectedSkillIndex((currentIndex) =>
            currentIndex <= 0
              ? filteredSkills.length - 1
              : currentIndex - 1,
          );
        }

        return;
      }

      if (
        (event.key === 'Enter' || event.key === 'Tab') &&
        filteredSkills.length > 0
      ) {
        event.preventDefault();

        const selectedSkill =
          filteredSkills[selectedSkillIndex];

        if (selectedSkill) {
          handleSkillSelect(selectedSkill);
        }

        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeSkillMenu();
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
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
          {isSkillMenuOpen && (
            <SkillMentionMenu
              skills={filteredSkills}
              selectedIndex={selectedSkillIndex}
              isLoading={isLoadingSkills}
              error={skillsError}
              onSelect={handleSkillSelect}
              onHover={setSelectedSkillIndex}
            />
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
            aria-expanded={isSkillMenuOpen}
            aria-controls={
              isSkillMenuOpen
                ? 'skill-mention-list'
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
          Type @ to select a skill. Mocu can make mistakes. Check
          important information.
        </p>
      </div>
    </div>
  );
}