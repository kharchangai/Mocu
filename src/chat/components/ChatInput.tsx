import {
  FolderOpen,
  Mic,
  Paperclip,
  SendHorizontal,
  Square,
  Blocks,
} from 'lucide-react';
import {
  useLayoutEffect,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { listAvailableSkills } from '../services/skillService';
import { listAvailableAgents } from '../agent/agent-loader';
import { scanInstalledExtensions } from '../../extensions/services/extension-scanner';
import { COMMANDS, CommandMenu } from './CommandMenu';
import {
  filterSkills,
  findActiveSlashCommand,
  type ActiveSlashCommand,
} from './skillMention';
import { filterExtensions } from './extensionMention';
import { filterMcpServers } from './mcpMention';
import type {
  AvailableSkill,
  SelectedSkill,
} from './skillTypes';
import type {
  AvailableExtension,
  SelectedExtension,
} from './extensionTypes';
import type {
  AvailableMcpServer,
  SelectedMcpServer,
} from './mcpTypes';
import {
  listMcpServers,
  subscribeToMcpManager,
} from '../../mcp/manager';
import { filterAgents } from './agentMention';
import { SlashMentionText } from './SlashMentionText';
import { ResourceToggleMenu } from './ResourceToggleMenu';
import {
  NEW_CHAT_RESOURCE_KEY,
  setChatResourceSelection,
  useChatResourceSelection,
} from '../services/chatResourceToggles';
import { autoConnectMcpServer } from '../services/pinnedMcpAutoConnect';
import type {
  AvailableAgent,
  SelectedAgent,
} from './agentTypes';
import './ChatInput.css';

export type SendOptions = {
  projectPath: string | null;
  selectedSkills: SelectedSkill[];
  selectedExtensions: SelectedExtension[];
  selectedMcpServers: SelectedMcpServer[];
  selectedAgent: SelectedAgent | null;
};

const RTL_CHARACTER_PATTERN = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const STRONG_CHARACTER_PATTERN = /[A-Za-z\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

export type ChatInputProps = {
  value?: string;
  chatId?: string | null;
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

type CommandMenuMode = 'commands' | 'skills' | 'extensions' | 'agents' | 'mcp';

/*
 * Keys of a resource selection that identify the same resource. The
 * slash flow and the toggle flow may both activate one, so the merged
 * list sent to the agent must not contain duplicates.
 */
const mergeSkillByName = (
  selections: SendOptions['selectedSkills'],
): SendOptions['selectedSkills'] => {
  const seen = new Set<string>();

  return selections.filter((skill) => {
    if (seen.has(skill.name)) {
      return false;
    }

    seen.add(skill.name);

    return true;
  });
};

const mergeExtensionsById = (
  selections: SendOptions['selectedExtensions'],
): SendOptions['selectedExtensions'] => {
  const seen = new Set<string>();

  return selections.filter((extension) => {
    if (seen.has(extension.id)) {
      return false;
    }

    seen.add(extension.id);

    return true;
  });
};

const mergeMcpServersById = (
  selections: SendOptions['selectedMcpServers'],
): SendOptions['selectedMcpServers'] => {
  const seen = new Set<string>();

  return selections.filter((server) => {
    if (seen.has(server.id)) {
      return false;
    }

    seen.add(server.id);

    return true;
  });
};

export function ChatInput({
  value = '',
  chatId = null,
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
   * The element inside the highlight layer that receives the scroll
   * offset. The transform must sit on this inner element: putting it on
   * the clipping layer itself would move the clip box together with the
   * text, letting long pasted messages render outside the composer.
   */
  const highlightContentRef = useRef<HTMLDivElement | null>(null);

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

  const [availableMcpServers, setAvailableMcpServers] = useState<
    AvailableMcpServer[]
  >([]);

  const [activeCommand, setActiveCommand] =
    useState<ActiveSlashCommand | null>(null);

  const [selectedSkills, setSelectedSkills] = useState<
    SelectedSkill[]
  >([]);

  const [selectedExtensions, setSelectedExtensions] = useState<
    SelectedExtension[]
  >([]);

  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(null);

  const [selectedMcpServers, setSelectedMcpServers] = useState<
    SelectedMcpServer[]
  >([]);

  /*
   * Resources the user toggled ON for this conversation. They are
   * stored outside React (persisted per chat) and are sent with every
   * message automatically, without a /mention in the text.
   */
  const pinnedResources = useChatResourceSelection(
    chatId ?? NEW_CHAT_RESOURCE_KEY,
  );

  const [isResourceMenuOpen, setIsResourceMenuOpen] = useState(false);

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

  const [isLoadingMcp, setIsLoadingMcp] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

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
        ...pinnedResources.skills.map((skill) => skill.name),
      ],
      extension: [
        ...availableExtensions.map((extension) => extension.name),
        ...selectedExtensions.map((extension) => extension.name),
        ...pinnedResources.extensions.map((extension) => extension.name),
      ],
      agent: [
        ...availableAgents.map((agent) => agent.name),
        ...(selectedAgent ? [selectedAgent.name] : []),
        ...(pinnedResources.agent ? [pinnedResources.agent.name] : []),
      ],
      mcp: [
        ...availableMcpServers.map((server) => server.name),
        ...selectedMcpServers.map((server) => server.name),
        ...pinnedResources.mcpServers.map((server) => server.name),
      ],
    }),
    [
      availableSkills,
      availableExtensions,
      availableAgents,
      availableMcpServers,
      selectedSkills,
      selectedExtensions,
      selectedAgent,
      selectedMcpServers,
      pinnedResources,
    ],
  );

  const canSend = safeValue.trim().length > 0 && !isLoading;
  const hasProjectPath = normalizedProjectPath !== null;

  /*
   * Names/ids of the pinned resources, used by the toggle menu to mark
   * which switches are on and by the chip row to render them.
   */
  const pinnedSkillNames = pinnedResources.skills.map(
    (skill) => skill.name,
  );
  const pinnedExtensionIds = pinnedResources.extensions.map(
    (extension) => extension.id,
  );
  const pinnedMcpServerIds = pinnedResources.mcpServers.map(
    (server) => server.id,
  );
  const pinnedAgentName = pinnedResources.agent?.name ?? null;

  const hasPinnedResources =
    pinnedResources.skills.length > 0 ||
    pinnedResources.extensions.length > 0 ||
    pinnedResources.mcpServers.length > 0 ||
    pinnedResources.agent !== null;

  const persistPinnedResources = (
    next: typeof pinnedResources,
  ) => {
    setChatResourceSelection(
      chatId ?? NEW_CHAT_RESOURCE_KEY,
      next,
    );
  };

  const handleToggleSkill = (
    skill: AvailableSkill,
    nextActive: boolean,
  ) => {
    if (nextActive) {
      persistPinnedResources({
        ...pinnedResources,
        skills: [
          ...pinnedResources.skills,
          {
            name: skill.name,
            source: skill.source,
            path: skill.path,
          },
        ],
      });

      return;
    }

    persistPinnedResources({
      ...pinnedResources,
      skills: pinnedResources.skills.filter(
        (pinned) => pinned.name !== skill.name,
      ),
    });
  };

  const handleToggleExtension = (
    extension: AvailableExtension,
    nextActive: boolean,
  ) => {
    if (nextActive) {
      persistPinnedResources({
        ...pinnedResources,
        extensions: [
          ...pinnedResources.extensions,
          {
            id: extension.id,
            name: extension.name,
            path: extension.path,
          },
        ],
      });

      return;
    }

    persistPinnedResources({
      ...pinnedResources,
      extensions: pinnedResources.extensions.filter(
        (pinned) => pinned.id !== extension.id,
      ),
    });
  };

  const handleToggleAgent = (
    agent: AvailableAgent,
    nextActive: boolean,
  ) => {
    persistPinnedResources({
      ...pinnedResources,
      agent: nextActive
        ? {
            id: agent.id,
            name: agent.name,
            path: agent.path,
          }
        : null,
    });
  };

  const handleToggleMcpServer = (
    server: AvailableMcpServer,
    nextActive: boolean,
  ) => {
    if (nextActive) {
      persistPinnedResources({
        ...pinnedResources,
        mcpServers: [
          ...pinnedResources.mcpServers,
          {
            id: server.id,
            name: server.name,
          },
        ],
      });

      /*
       * Connect right away so the server is usable without visiting
       * the MCP page. Approval-gated stdio servers are never
       * auto-approved; the composer keeps working and the send path
       * reports the server as unresolved until it is approved.
       */
      autoConnectMcpServer(server.id, server.name);

      return;
    }

    persistPinnedResources({
      ...pinnedResources,
      mcpServers: pinnedResources.mcpServers.filter(
        (pinned) => pinned.id !== server.id,
      ),
    });
  };

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
            : activeCommand.command === 'mcp'
              ? 'mcp'
              : 'commands';

  const activeCommandQuery =
    (activeCommand?.command === 'skill' ||
      activeCommand?.command === 'extension' ||
      activeCommand?.command === 'agent' ||
      activeCommand?.command === 'mcp'
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

  const filteredMcpServers = useMemo(() => {
    if (commandMenuMode !== 'mcp') {
      return [];
    }

    return filterMcpServers(
      availableMcpServers,
      activeCommandQuery,
    );
  }, [commandMenuMode, availableMcpServers, activeCommandQuery]);

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

  const loadMcpServers = useCallback(async () => {
    setIsLoadingMcp(true);
    setMcpError(null);

    try {
      const servers = await listMcpServers();

      setAvailableMcpServers(
        servers
          .filter((server) => server.config.enabled)
          .map((server) => ({
            id: server.config.id,
            name: server.config.name,
            description:
              server.config.transport === 'stdio'
                ? `Local MCP server: ${server.config.command}`
                : `Remote MCP server: ${server.config.url}`,
          })),
      );
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
      setAvailableMcpServers([]);
      setMcpError(
        error instanceof Error
          ? error.message
          : 'Failed to load MCP servers.',
      );
    } finally {
      setIsLoadingMcp(false);
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
    void loadMcpServers();

    // The MCP page can add, remove, or enable a server while the chat
    // composer is mounted. Keep the slash menu in sync without requiring a
    // full app reload.
    return subscribeToMcpManager(() => {
      void loadMcpServers();
    });
  }, [loadMcpServers]);

  /*
   * useLayoutEffect (not useEffect) so the height and highlight offset are
   * applied before the browser paints. Otherwise one frame can render with
   * the old height, momentarily scrolling or misaligning the highlight layer.
   */
  useLayoutEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      180,
    )}px`;

    if (highlightContentRef.current) {
      highlightContentRef.current.style.transform = `translateY(-${textarea.scrollTop}px)`;
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
            : commandMenuMode === 'mcp'
              ? filteredMcpServers.length
              : COMMANDS.length;

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
    filteredMcpServers.length,
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

    setSelectedMcpServers((currentServers) =>
      currentServers.filter((server) =>
        nextValue.includes(`/mcp ${server.name}`),
      ),
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
      (command !== 'skill' &&
        command !== 'extension' &&
        command !== 'agent' &&
        command !== 'mcp')
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

  const handleMcpServerSelect = (server: AvailableMcpServer) => {
    const nextValue = replaceActiveMention(`/mcp ${server.name}`);

    if (nextValue === null) {
      return;
    }

    setSelectedMcpServers((currentServers) =>
      currentServers.some((selected) => selected.id === server.id)
        ? currentServers
        : [
            ...currentServers,
            {
              id: server.id,
              name: server.name,
            },
          ],
    );
  };

  const handleSend = async () => {
    const message = safeValue.trim();

    if (!message || isLoading) {
      return;
    }

    /*
     * Pinned resources stay active after sending; only the slash
     * selections made for THIS message are cleared. Both sets are
     * merged and de-duplicated so the agent receives each resource
     * once.
     */
    const skillsToSend = mergeSkillByName([
      ...pinnedResources.skills,
      ...selectedSkills,
    ]);
    const extensionsToSend = mergeExtensionsById([
      ...pinnedResources.extensions,
      ...selectedExtensions,
    ]);
    const mcpServersToSend = mergeMcpServersById([
      ...pinnedResources.mcpServers,
      ...selectedMcpServers,
    ]);
    const agentToSend = selectedAgent ?? pinnedResources.agent;

    setSendError(null);
    closeCommandMenu();
    setIsResourceMenuOpen(false);
    setSelectedSkills([]);
    setSelectedExtensions([]);
    setSelectedAgent(null);
    setSelectedMcpServers([]);
    onValueChange('');

    try {
      await onSend(message, {
        projectPath: normalizedProjectPath,
        selectedSkills: skillsToSend,
        selectedExtensions: extensionsToSend,
        selectedMcpServers: mcpServersToSend,
        selectedAgent: agentToSend,
      });

      settledMentionsRef.current = [];
    } catch (error) {
      /*
       * Restore the message and the selected resources when sending fails.
       */
      onValueChange(message);
      setSelectedSkills(
        skillsToSend.filter(
          (skill) => !pinnedSkillNames.includes(skill.name),
        ),
      );
      setSelectedExtensions(
        extensionsToSend.filter(
          (extension) => !pinnedExtensionIds.includes(extension.id),
        ),
      );
      setSelectedAgent(
        agentToSend && agentToSend !== pinnedResources.agent
          ? agentToSend
          : null,
      );
      setSelectedMcpServers(
        mcpServersToSend.filter(
          (server) => !pinnedMcpServerIds.includes(server.id),
        ),
      );
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
              : commandMenuMode === 'mcp'
                ? filteredMcpServers.length
                : COMMANDS.length;

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
        } else if (commandMenuMode === 'mcp') {
          const selectedServer = filteredMcpServers[selectedItemIndex];

          if (selectedServer) {
            handleMcpServerSelect(selectedServer);
          }
        } else {
          // Use the same command definition that renders the menu. This
          // prevents keyboard selection from drifting away from the item
          // the user sees (the old index map swapped MCP and Agent).
          const commandItem = COMMANDS[selectedItemIndex]?.command;

          if (commandItem) {
            handleSelectCommand(commandItem);
          }
        }

        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setIsResourceMenuOpen(false);
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
    if (highlightContentRef.current) {
      highlightContentRef.current.style.transform = `translateY(-${event.currentTarget.scrollTop}px)`;
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
        : commandMenuMode === 'mcp'
          ? {
              isLoading: isLoadingMcp,
              error: mcpError,
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
          {isResourceMenuOpen && (
            <ResourceToggleMenu
              skills={availableSkills}
              extensions={availableExtensions}
              agents={availableAgents}
              mcpServers={availableMcpServers}
              pinnedSkillNames={pinnedSkillNames}
              pinnedExtensionIds={pinnedExtensionIds}
              pinnedAgentName={pinnedAgentName}
              pinnedMcpServerIds={pinnedMcpServerIds}
              onToggleSkill={handleToggleSkill}
              onToggleExtension={handleToggleExtension}
              onToggleAgent={handleToggleAgent}
              onToggleMcpServer={handleToggleMcpServer}
              isLoading={
                isLoadingSkills ||
                isLoadingExtensions ||
                isLoadingAgents ||
                isLoadingMcp
              }
              error={
                skillsError ??
                extensionsError ??
                agentsError ??
                mcpError
              }
              onClose={() => setIsResourceMenuOpen(false)}
            />
          )}

          {hasPinnedResources && (
            <div
              className="resource-chips"
              aria-label="Resources active for this chat"
            >
              {pinnedResources.skills.map((skill) => (
                <span
                  key={`skill-${skill.name}`}
                  className="resource-chip"
                >
                  <span className="resource-chip-type">skill</span>
                  {skill.name}
                  <button
                    type="button"
                    className="resource-chip-remove"
                    onClick={() =>
                      handleToggleSkill(
                        {
                          id: skill.name,
                          name: skill.name,
                          description: '',
                          source: skill.source,
                          path: skill.path,
                        },
                        false,
                      )
                    }
                    aria-label={`Deactivate skill ${skill.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}

              {pinnedResources.extensions.map((extension) => (
                <span
                  key={`extension-${extension.id}`}
                  className="resource-chip"
                >
                  <span className="resource-chip-type">ext</span>
                  {extension.name}
                  <button
                    type="button"
                    className="resource-chip-remove"
                    onClick={() =>
                      handleToggleExtension(
                        {
                          id: extension.id,
                          name: extension.name,
                          description: '',
                          path: extension.path,
                          commands: [],
                        },
                        false,
                      )
                    }
                    aria-label={`Deactivate extension ${extension.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}

              {pinnedResources.agent && (
                <span className="resource-chip">
                  <span className="resource-chip-type">agent</span>
                  {pinnedResources.agent.name}
                  <button
                    type="button"
                    className="resource-chip-remove"
                    onClick={() =>
                      handleToggleAgent(
                        {
                          id: pinnedResources.agent!.id,
                          name: pinnedResources.agent!.name,
                          description: '',
                          path: pinnedResources.agent!.path,
                        },
                        false,
                      )
                    }
                    aria-label={`Deactivate agent ${pinnedResources.agent!.name}`}
                  >
                    ✕
                  </button>
                </span>
              )}

              {pinnedResources.mcpServers.map((server) => (
                <span
                  key={`mcp-${server.id}`}
                  className="resource-chip"
                >
                  <span className="resource-chip-type">mcp</span>
                  {server.name}
                  <button
                    type="button"
                    className="resource-chip-remove"
                    onClick={() =>
                      handleToggleMcpServer(
                        {
                          id: server.id,
                          name: server.name,
                          description: '',
                        },
                        false,
                      )
                    }
                    aria-label={`Deactivate MCP server ${server.name}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {isCommandMenuOpen && (
            <CommandMenu
              mode={commandMenuMode ?? 'commands'}
              commandQuery={activeCommandQuery}
              skills={filteredSkills}
              extensions={filteredExtensions}
              agents={filteredAgents}
              mcpServers={filteredMcpServers}
              selectedIndex={selectedItemIndex}
              isLoading={loadSuffix.isLoading}
              error={loadSuffix.error}
              onSelectCommand={handleSelectCommand}
              onSelectSkill={handleSkillSelect}
              onSelectExtension={handleExtensionSelect}
              onSelectAgent={handleAgentSelect}
              onSelectMcpServer={handleMcpServerSelect}
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
              <div
                ref={highlightContentRef}
                className="chat-input-highlight-scroll"
              >
                <SlashMentionText
                  content={safeValue}
                  className="chat-input-highlight-content"
                  resourceNames={mentionResourceNames}
                />
              </div>
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
                className={`composer-icon-button${
                  hasPinnedResources || isResourceMenuOpen
                    ? ' composer-icon-button--active'
                    : ''
                }`}
                onClick={() =>
                  setIsResourceMenuOpen((open) => !open)
                }
                aria-label="Choose resources active for this chat"
                aria-expanded={isResourceMenuOpen}
                title="Choose resources active for this chat"
              >
                <Blocks size={17} />
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
          Use the blocks button to keep resources active for this chat, or type
          /skill, /extension, /mcp, or /agent to select resources for a single
          request. MCP tools are available only for requests where a server is
          selected. Mocu can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}
