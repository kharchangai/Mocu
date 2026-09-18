import {
  FolderOpen,
  Mic,
  Paperclip,
  SendHorizontal,
  Square,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { listAvailableSkills } from '../services/skillService';
import { listAvailableAgents } from '../agent/agent-loader';
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
import { filterAgents } from './agentMention';
import { SlashMentionText } from './SlashMentionText';
import type {
  AvailableAgent,
  SelectedAgent,
} from './agentTypes';
import './ChatInput.css';

export type SendOptions = {
  projectPath: string | null;
  selectedSkills: SelectedSkill[];
  selectedExtensions: SelectedExtension[];
  selectedAgent: SelectedAgent | null;
};

const RTL_CHARACTER_PATTERN = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const STRONG_CHARACTER_PATTERN = /[A-Za-z\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

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

type CommandMenuMode = 'commands' | 'skills' | 'extensions' | 'agents';

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
  const highlightRef = useRef<HTMLDivElement | null>(null);

  /*
   * Ranges of mentions that were already chosen from the menu. While the
   * caret stays inside or after one of them the command menu stays closed,
   * so continuing to write does not reopen the chooser.
   */
  const settledMentionsRef = useRef<
    { start: number; end: number; text: string }[]
  >([]);

  const [availableSkills, setAvailableSkills] = useState<
    AvailableSkill[]
  >([]);

  const [availableExtensions, setAvailableExtensions] = useState<
    AvailableExtension[]
  >([]);

  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);

  const [activeCommand, setActiveCommand] =
    useState<ActiveSlashCommand | null>(null);

  const [selectedSkills, setSelectedSkills] = useState<
    SelectedSkill[]
  >([]);

  const [selectedExtensions, setSelectedExtensions] = useState<
    SelectedExtension[]
  >([]);

  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(null);

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

  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  const [sendError, setSendError] = useState<string | null>(null);

  const safeValue = typeof value === 'string' ? value : '';
  const safeProjectPath =
    typeof projectPath === 'string' ? projectPath : '';

  const normalizedProjectPath =
    safeProjectPath.trim().length > 0
      ? safeProjectPath.trim()
      : null;

  const inputDirection = (() => {
    const firstStrongCharacter = safeValue.match(
      STRONG_CHARACTER_PATTERN,
    )?.[0];

    return firstStrongCharacter && RTL_CHARACTER_PATTERN.test(firstStrongCharacter)
      ? 'rtl'
      : 'ltr';
  })();

  const mentionResourceNames = useMemo(
    () => ({
      skill: [
        ...availableSkills.map((skill) => skill.name),
        ...selectedSkills.map((skill) => skill.name),
      ],
      extension: [
        ...availableExtensions.map((extension) => extension.name),
        ...selectedExtensions.map((extension) => extension.name),
      ],
      agent: [
        ...availableAgents.map((agent) => agent.name),
        ...(selectedAgent ? [selectedAgent.name] : []),
      ],
    }),
    [
      availableSkills,
      availableExtensions,
      availableAgents,
      selectedSkills,
      selectedExtensions,
      selectedAgent,
    ],
  );

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
          : activeCommand.command === 'agent'
            ? 'agents'
            : 'commands';

  const activeCommandQuery =
    (activeCommand?.command === 'skill' ||
      activeCommand?.command === 'extension' ||
      activeCommand?.command === 'agent'
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

  const filteredAgents = useMemo(() => {
    if (commandMenuMode !== 'agents') {
      return [];
    }

    return filterAgents(availableAgents, activeCommandQuery);
  }, [commandMenuMode, availableAgents, activeCommandQuery]);

  const loadSkills = useCallback(async () => {
    setIsLoadingSkills(true);
    setSkillsError(null);

    try {
      const skills = await listAvailableSkills();

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
  }, []);

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

  const loadAgents = useCallback(async () => {
    setIsLoadingAgents(true);
    setAgentsError(null);

    try {
      const installed = await listAvailableAgents();
      setAvailableAgents(
        installed.map((agent) => ({
          id: agent.id,
          name: agent.agentName,
          description: agent.description,
          path: agent.path,
        })),
      );
    } catch (error) {
      console.error('Failed to load agents:', error);
      setAvailableAgents([]);
      setAgentsError(
        error instanceof Error
          ? error.message
          : 'Failed to load available agents.',
      );
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

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

    if (highlightRef.current) {
      highlightRef.current.style.transform = `translateY(-${textarea.scrollTop}px)`;
    }
  }, [safeValue]);

  useEffect(() => {
    const menuItemCount =
      commandMenuMode === 'skills'
        ? filteredSkills.length
        : commandMenuMode === 'extensions'
          ? filteredExtensions.length
          : commandMenuMode === 'agents'
            ? filteredAgents.length
            : 3;

    if (
      selectedItemIndex >= menuItemCount &&
      menuItemCount > 0
    ) {
      setSelectedItemIndex(menuItemCount - 1);
    }
  }, [
    filteredSkills.length,
    filteredExtensions.length,
    filteredAgents.length,
    selectedItemIndex,
    commandMenuMode,
  ]);

  const updateActiveCommand = (
    nextValue: string,
    caretPosition: number,
  ) => {
    /*
     * Re-anchor settled mentions after edits. When the exact text is no
     * longer present, the mention was deleted and is forgotten.
     */
    settledMentionsRef.current = settledMentionsRef.current.flatMap(
      (mention) => {
        if (
          nextValue.slice(
            mention.start,
            mention.start + mention.text.length,
          ) === mention.text
        ) {
          return [mention];
        }

        const reanchoredStart = nextValue.indexOf(mention.text);

        return reanchoredStart >= 0
          ? [
              {
                ...mention,
                start: reanchoredStart,
                end: reanchoredStart + mention.text.length,
              },
            ]
          : [];
      },
    );

    const command = findActiveSlashCommand(
      nextValue,
      caretPosition,
    );

    /*
     * The caret is at or beyond the end of an already chosen mention, so
     * this match is the settled mention itself and not a new command.
     */
    const matchesSettledMention =
      command !== null &&
      settledMentionsRef.current.some(
        (mention) =>
          command.start === mention.start &&
          command.end >= mention.end,
      );

    setActiveCommand(matchesSettledMention ? null : command);
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

  const keepSelectedResourcesInSync = (nextValue: string) => {
    setSelectedSkills((currentSkills) =>
      currentSkills.filter((skill) =>
        nextValue.includes(`/skill ${skill.name}`),
      ),
    );
    setSelectedExtensions((currentExtensions) =>
      currentExtensions.filter((extension) =>
        nextValue.includes(`/extension ${extension.name}`),
      ),
    );

    setSelectedAgent((currentAgent) =>
      currentAgent && nextValue.includes(`/agent ${currentAgent.name}`)
        ? currentAgent
        : null,
    );
  };

  const handleMessageChange = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const nextValue = event.target.value;
    const caretPosition = event.target.selectionStart;

    keepSelectedResourcesInSync(nextValue);
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

  const handleChooseFolder = async () => {
    if (!onChooseProjectFolder) {
      return;
    }

    await onChooseProjectFolder();
  };

  /*
   * Select the "/skill" or "/extension" command from the bare "/"
   * command menu. This keeps the caret after "/<command> " so the menu
   * switches to the matching list and the user can keep typing.
   */
  const handleSelectCommand = (command: string) => {
    if (
      !activeCommand ||
      (command !== 'skill' && command !== 'extension' && command !== 'agent')
    ) {
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
   * Keep the selected resource in the message. Apart from making the
   * request understandable when it is copied, this lets the composer render
   * the resource name inline instead of placing a second row of tags above
   * the input.
   */
  const replaceActiveMention = (mention: string) => {
    if (!activeCommand) {
      return null;
    }

    const textBeforeMention = safeValue.slice(0, activeCommand.start);
    const textAfterMention = safeValue.slice(activeCommand.end);
    const nextValue = textBeforeMention + mention + textAfterMention;
    const nextCaretPosition = textBeforeMention.length + mention.length;

    settledMentionsRef.current = [
      ...settledMentionsRef.current,
      {
        start: activeCommand.start,
        end: nextCaretPosition,
        text: mention,
      },
    ];

    onValueChange(nextValue);
    closeCommandMenu();
    setTextareaCaret(nextCaretPosition);

    return nextValue;
  };

  const handleSkillSelect = (skill: AvailableSkill) => {
    const nextValue = replaceActiveMention(`/skill ${skill.name}`);

    if (nextValue === null) {
      return;
    }

    setSelectedSkills((currentSkills) =>
      currentSkills.some((selected) => selected.name === skill.name)
        ? currentSkills
        : [
            ...currentSkills,
            {
              name: skill.name,
              source: skill.source,
              path: skill.path,
            },
          ],
    );
  };

  const handleExtensionSelect = (extension: AvailableExtension) => {
    const nextValue = replaceActiveMention(
      `/extension ${extension.name}`,
    );

    if (nextValue === null) {
      return;
    }

    setSelectedExtensions((currentExtensions) =>
      currentExtensions.some((selected) => selected.id === extension.id)
        ? currentExtensions
        : [
            ...currentExtensions,
            {
              id: extension.id,
              name: extension.name,
              path: extension.path,
            },
          ],
    );
  };

  const handleAgentSelect = (agent: AvailableAgent) => {
    const nextValue = replaceActiveMention(`/agent ${agent.name}`);

    if (nextValue === null) {
      return;
    }

    setSelectedAgent({
      id: agent.id,
      name: agent.name,
      path: agent.path,
    });
  };

  const handleSend = async () => {
    const message = safeValue.trim();

    if (!message || isLoading) {
      return;
    }

    const skillsToSend = [...selectedSkills];
    const extensionsToSend = [...selectedExtensions];
    const agentToSend = selectedAgent;

    setSendError(null);
    closeCommandMenu();
    setSelectedSkills([]);
    setSelectedExtensions([]);
    setSelectedAgent(null);
    onValueChange('');

    try {
      await onSend(message, {
        projectPath: normalizedProjectPath,
        selectedSkills: skillsToSend,
        selectedExtensions: extensionsToSend,
        selectedAgent: agentToSend,
      });

      settledMentionsRef.current = [];
    } catch (error) {
      /*
       * Restore the message and the selected skills/extensions when
       * sending fails.
       */
      onValueChange(message);
      setSelectedSkills(skillsToSend);
      setSelectedExtensions(extensionsToSend);
      setSelectedAgent(agentToSend);
      setSendError(
        error instanceof Error
          ? error.message
          : 'The message could not be sent.',
      );
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
            : commandMenuMode === 'agents'
              ? filteredAgents.length
              : 3;

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
        } else if (commandMenuMode === 'agents') {
          const selectedAgentItem = filteredAgents[selectedItemIndex];

          if (selectedAgentItem) {
            handleAgentSelect(selectedAgentItem);
          }
        } else {
          const commandItem =
            selectedItemIndex === 0
              ? 'skill'
              : selectedItemIndex === 1
                ? 'extension'
                : 'agent';

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
        void handleSend().catch(() => undefined);
      }
    }
  };

  const handleTextareaScroll = (
    event: React.UIEvent<HTMLTextAreaElement>,
  ) => {
    if (highlightRef.current) {
      highlightRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
    }
  };

  const loadSuffix =
    commandMenuMode === 'extensions'
      ? {
          isLoading: isLoadingExtensions,
          error: extensionsError,
        }
      : commandMenuMode === 'agents'
        ? {
            isLoading: isLoadingAgents,
            error: agentsError,
          }
        : {
            isLoading: isLoadingSkills,
            error: skillsError,
          };

  return (
    <div className="chat-input-shell">
      <div className="chat-input-inner">
        {hasProjectPath && (
          <div className="project-path-bar">
            <FolderOpen size={13} />

            <input
              type="text"
              value={safeProjectPath}
              onChange={handleProjectPathChange}
              placeholder="Project folder path..."
              aria-label="Project folder path"
              title={safeProjectPath}
            />
          </div>
        )}

        <div className="chat-composer">
          {isCommandMenuOpen && (
            <CommandMenu
              mode={commandMenuMode ?? 'commands'}
              commandQuery={activeCommandQuery}
              skills={filteredSkills}
              extensions={filteredExtensions}
              agents={filteredAgents}
              selectedIndex={selectedItemIndex}
              isLoading={loadSuffix.isLoading}
              error={loadSuffix.error}
              onSelectCommand={handleSelectCommand}
              onSelectSkill={handleSkillSelect}
              onSelectExtension={handleExtensionSelect}
              onSelectAgent={handleAgentSelect}
              onHover={setSelectedItemIndex}
            />
          )}

          <div className="chat-input-editor">
            <div
              ref={highlightRef}
              className="chat-input-highlight"
              aria-hidden="true"
              dir={inputDirection}
              style={{ direction: inputDirection }}
            >
              <SlashMentionText
                content={safeValue}
                className="chat-input-highlight-content"
                resourceNames={mentionResourceNames}
              />
            </div>

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
            onScroll={handleTextareaScroll}
            placeholder={`Message ${agentName}`}
            rows={1}
            dir={inputDirection}
            disabled={isLoading}
            aria-label={`Message ${agentName}`}
            aria-expanded={isCommandMenuOpen}
            aria-controls={
              isCommandMenuOpen
                ? 'command-menu-list'
                : undefined
            }
            />
          </div>

          <div className="chat-composer-footer">
            <div className="chat-composer-left-actions">
              <button
                type="button"
                className="composer-icon-button"
                onClick={() => void handleChooseFolder()}
                aria-label="Choose a project folder"
                title="Choose a project folder"
              >
                <FolderOpen size={17} />
              </button>

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
                  onClick={() => void handleSend().catch(() => undefined)}
                  disabled={!canSend}
                  aria-label="Send message"
                >
                  <SendHorizontal size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        {sendError ? (
          <p className="chat-input-error" role="alert">
            {sendError}
          </p>
        ) : null}

        <p className="chat-input-disclaimer">
          Type /skill, /extension, or /agent to select resources for this
          request. Mocu can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}
