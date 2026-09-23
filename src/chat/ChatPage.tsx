import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { BellRing, Bot, X } from 'lucide-react';

import {
  open,
} from '@tauri-apps/plugin-dialog';

import {
  ChatSidebar,
  type ChatSidebarItemId,
} from './components/ChatSidebar';

import {
  ChatBox,
} from './components/ChatBox';
import { StepWorkflowPanel } from './components/StepWorkflowPanel';
import { RightPanelDock } from './components/RightPanelDock';

import {
  SkillsPage,
} from './components/skills/SkillsPage';

import {
  DocsPage,
} from './components/docs/DocsPage';

import { SchedulePage } from '../schedule/components/SchedulePage';
import {
  SCHEDULE_AGENT_COMPLETE_EVENT,
  SCHEDULE_REMINDER_EVENT,
  type ScheduleAgentCompletionPayload,
  type ScheduleReminderPayload,
} from '../schedule/scheduler';

import {
  Settings,
} from '../components/Settings';

import {
  MocuMiniCube,
} from './components/MocuMiniCube';

import {
  ExtensionsPage,
} from '../extensions/components/ExtensionsPage';

import {
  McpPage,
} from '../mcp/components/McpPage';

import { AgentsPage } from './components/agents/AgentsPage';

import {
  useChatHistory,
  type EnsureChatResult,
} from './hooks/useChatHistory';

import {
  consumeRecoveredMessages,
  startExtensionJobRecovery,
} from '../extensions/services/extension-job-recovery';

import type {
  ChatMessage,
  RecentChat,
} from './types/chat';

import './ChatPage.css';

type ScheduleNotice = {
  kind: 'reminder' | 'agent';
  title: string;
  message: string;
  status?: 'completed' | 'failed';
};

function ChatPage() {
  const [
    activeItem,
    setActiveItem,
  ] = useState<ChatSidebarItemId>(
    'new-chat',
  );

  const [
    isChatsOpen,
    setIsChatsOpen,
  ] = useState(false);

  const [
    isProjectsOpen,
    setIsProjectsOpen,
  ] = useState(false);

  const [
    scheduleNotice, setScheduleNotice,
  ] = useState<ScheduleNotice | null>(null);

  /*
   * Bumped whenever the extension-job recovery service stores a recovered
   * result, so the consume effect below re-runs even though `chats` did
   * not change.
   */
  const [
    recoveredJobsTick,
    setRecoveredJobsTick,
  ] = useState(0);

  /* Whether a step-by-step workflow is active for the current chat. Drives
   * the right dock: collapsed (no space) when nothing is active. */
  const [
    stepWorkflowActive,
    setStepWorkflowActive,
  ] = useState(false);

  useEffect(() => {
    /*
     * Recover extension commands that were still running when the webview
     * reloaded or the app restarted (e.g. a long pi agent run). Each
     * finished job becomes a recovered assistant message for the
     * conversation that started it.
     */
    const dispose = startExtensionJobRecovery();

    const handleRecovered = (): void => {
      setRecoveredJobsTick((current) => current + 1);
    };

    window.addEventListener(
      'mocu_extension_jobs_recovered',
      handleRecovered,
    );

    return () => {
      dispose();

      window.removeEventListener(
        'mocu_extension_jobs_recovered',
        handleRecovered,
      );
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanups: Array<() => void> = [];

    const setupListeners = async () => {
      const [removeReminderListener, removeAgentListener] = await Promise.all([
        listen<ScheduleReminderPayload>(SCHEDULE_REMINDER_EVENT, (event) => {
          setScheduleNotice({
            kind: 'reminder',
            title: event.payload.title,
            message: event.payload.text,
          });
        }),
        listen<ScheduleAgentCompletionPayload>(SCHEDULE_AGENT_COMPLETE_EVENT, (event) => {
          setScheduleNotice({
            kind: 'agent',
            title: event.payload.title,
            message: event.payload.message,
            status: event.payload.status,
          });
        }),
      ]);

      if (disposed) {
        removeReminderListener();
        removeAgentListener();
      } else {
        cleanups = [removeReminderListener, removeAgentListener];
      }
    };

    void setupListeners().catch((error) => {
      console.error('[Chat Page] Failed to listen for schedule events:', error);
    });

    return () => {
      disposed = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  useEffect(() => {
    if (!scheduleNotice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setScheduleNotice(null);
    }, 10000);

    return () => window.clearTimeout(timeout);
  }, [scheduleNotice]);

  /*
   * This path is used by a new chat before a chat record exists.
   */
  const [
    defaultProjectPath,
    setDefaultProjectPath,
  ] = useState('');

  const {
    activeChat,
    activeChatId,
    chats,
    startNewChat,
    selectChat,
    ensureChat,
    loadProjectConversation,
    appendMessage,
    updateChatProjectPath,
    deleteChat,
  } = useChatHistory();

  /*
   * When an interrupted extension run has recovered, append its result to
   * the conversation that started it — but only when that conversation
   * still ends with an unanswered user message (i.e. the run really was
   * cut off; if the turn completed normally the result is discarded).
   */
  useEffect(() => {
    const consumable = consumeRecoveredMessages(chats);

    for (const message of consumable) {
      appendMessage(
        message.chatId,
        'assistant',
        message.content,
      );
    }
  }, [
    chats,
    recoveredJobsTick,
    appendMessage,
  ]);

  /*
   * Conversations without a project folder are displayed under Chats.
   */
  const regularChats =
    useMemo<RecentChat[]>(
      () =>
        chats
          .filter(
            (chat) =>
              !chat.projectPath ||
              chat.projectPath.trim() === '',
          )
          .map((chat) => ({
            id: chat.id,
            title: chat.title,
          })),
      [chats],
    );

  /*
   * Conversations with a project folder are displayed under Projects.
   */
  const projectChats =
    useMemo<RecentChat[]>(
      () =>
        chats
          .filter(
            (chat) =>
              Boolean(
                chat.projectPath &&
                  chat.projectPath.trim() !== '',
              ),
          )
          .map((chat) => ({
            id: chat.id,
            title: chat.title,
          })),
      [chats],
    );

  /*
   * An existing chat uses its own project path.
   * A new chat uses the currently selected default project path.
   */
  const currentProjectPath =
    activeChat?.projectPath ??
    defaultProjectPath;

  const normalizedProjectPath =
    currentProjectPath.trim();

  const hasProjectFolder =
    normalizedProjectPath !== '';

  const handleProjectPathChange =
    useCallback(
      (
        newProjectPath: string,
      ): void => {
        const normalizedPath =
          newProjectPath.trim();

        setDefaultProjectPath(
          normalizedPath,
        );

        if (activeChatId) {
          updateChatProjectPath(
            activeChatId,
            normalizedPath,
          );
        }
      },
      [
        activeChatId,
        updateChatProjectPath,
      ],
    );

  const handleProjectFolderSelected =
    useCallback(
      async (
        folderPath: string,
      ): Promise<void> => {
        const normalizedFolderPath =
          folderPath.trim();

        if (!normalizedFolderPath) {
          return;
        }

        /*
         * Do not update the currently active chat's projectPath here.
         * Selecting a folder is navigation, not an edit to the existing
         * conversation. Mutating chat A to point at folder B before loading
         * B can make both chats share the same history file; the duplicate
         * cleanup then removes chat A and a later send targets the wrong
         * conversation.
         *
         * A newly selected folder becomes the default for a new chat. If it
         * already has a persisted conversation, loadProjectConversation
         * makes that conversation active below.
         */
        setDefaultProjectPath(normalizedFolderPath);

        /*
         * If this project already has a conversation stored inside
         * .mocu/memory, load it and make it active. Keep the current chat
         * visible until this read completes; otherwise a slow or failed
         * read can strand the user on a blank New chat page.
         */
        const loadedConversation =
          await loadProjectConversation(
            normalizedFolderPath,
          );

        if (!loadedConversation) {
          /*
           * There is no saved conversation for this folder, so future
           * messages must not be appended to the previous project.
           */
          startNewChat();
        }

        setActiveItem('new-chat');

        if (loadedConversation) {
          console.log(
            '[Chat Page] Resumed project conversation:',
            loadedConversation.id,
          );
        }
      },
      [
        loadProjectConversation,
        startNewChat,
      ],
    );

  const handleChooseProjectFolder =
    useCallback(
      async (): Promise<void> => {
        try {
          const selectedFolder =
            await open({
              directory: true,
              multiple: false,
              title:
                'Choose a project folder',
            });

          if (selectedFolder === null) {
            return;
          }

          const folderPath =
            Array.isArray(
              selectedFolder,
            )
              ? selectedFolder[0]
              : selectedFolder;

          if (
            typeof folderPath !==
              'string' ||
            folderPath.trim() === ''
          ) {
            return;
          }

          const normalizedFolderPath =
            folderPath.trim();

          await handleProjectFolderSelected(
            normalizedFolderPath,
          );

          console.log(
            '[Chat Page] Selected project folder:',
            normalizedFolderPath,
          );
        } catch (error) {
          console.error(
            '[Chat Page] Failed to choose the project folder:',
            error,
          );
        }
      },
      [
        handleProjectFolderSelected,
      ],
    );

  /*
   * Handles every sidebar navigation item.
   *
   * Chats and Projects only toggle their accordions.
   * Skills, Extensions, Packages and Settings change the main page.
   */
  const handleSidebarSelect =
    useCallback(
      (
        item: ChatSidebarItemId,
      ): void => {
        switch (item) {
          case 'new-chat': {
            startNewChat();

            setDefaultProjectPath('');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);
            setActiveItem('new-chat');

            return;
          }

          case 'chats': {
            setIsChatsOpen(
              (current) => !current,
            );

            return;
          }

          case 'projects': {
            setIsProjectsOpen(
              (current) => !current,
            );

            return;
          }

          case 'skills': {
            /*
             * This is the important part for opening Skills.
             */
            setActiveItem('skills');

            /*
             * Close conversation accordions when opening a full page.
             */
            setIsChatsOpen(false);
            setIsProjectsOpen(false);

            return;
          }

          case 'schedule': {
            setActiveItem('schedule');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);

            return;
          }

          case 'docs': {
            setActiveItem('docs');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);

            return;
          }

          case 'extensions': {
            setActiveItem('extensions');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);

            return;
          }

          case 'mcp': {
            setActiveItem('mcp');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);
            return;
          }

          case 'agents': {
            setActiveItem('agents');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);
            return;
          }

          case 'settings': {
            setActiveItem('settings');
            setIsChatsOpen(false);
            setIsProjectsOpen(false);

            return;
          }

          default: {
            const exhaustiveCheck:
              never = item;

            return exhaustiveCheck;
          }
        }
      },
      [startNewChat],
    );

  const handleToggleChats =
    useCallback((): void => {
      handleSidebarSelect('chats');
    }, [handleSidebarSelect]);

  const handleToggleProjects =
    useCallback((): void => {
      handleSidebarSelect('projects');
    }, [handleSidebarSelect]);

  const handleSelectRecentChat =
    useCallback(
      (chatId: string): void => {
        selectChat(chatId);

        /*
         * Saved chats use the same conversation screen.
         */
        setActiveItem('new-chat');
      },
      [selectChat],
    );

  const handleEnsureChat =
    useCallback(
      async (
        firstMessage: string,
        projectPath: string,
        initialHistory?: ChatMessage[],
      ): Promise<EnsureChatResult> => {
        /*
         * Use exactly the project path resolved by the caller.
         *
         * Never fall back to the last selected default project path:
         * a chat without a project must stay project-less so project
         * skills are never loaded from a stale project directory.
         */
        const effectiveProjectPath =
          projectPath.trim();

        const result =
          await ensureChat(
            firstMessage,
            effectiveProjectPath,
            initialHistory ?? [],
          );

        setActiveItem('new-chat');

        return result;
      },
      [
        ensureChat,
      ],
    );

  const handleDeleteChat =
    useCallback(
      (chatId: string): void => {
        deleteChat(chatId);

        if (chatId === activeChatId) {
          setActiveItem('new-chat');
        }
      },
      [
        activeChatId,
        deleteChat,
      ],
    );

  const renderConversation = () => (
    <div className="chat-conversation-layout">
      <div className="chat-conversation-main">
        <header className="chat-header">
          <span className="chat-header-title">
            {activeChat?.title ??
              'New chat'}
          </span>
        </header>

        <ChatBox
          chatId={activeChatId}
          messages={
            activeChat?.messages ?? []
          }
          agentName="Mocu"
          projectPath={
            currentProjectPath
          }
          onEnsureChat={
            handleEnsureChat
          }
          onAppendMessage={
            appendMessage
          }
          onProjectPathChange={
            handleProjectPathChange
          }
          onChooseProjectFolder={
            handleChooseProjectFolder
          }
        />
      </div>

      <RightPanelDock hidden={!stepWorkflowActive}>
        <StepWorkflowPanel
          key={`step-workflow-sidebar-${activeChatId ?? 'new-chat'}`}
          chatId={activeChatId}
          refreshKey={activeChat?.messages.length ?? 0}
          onActiveChange={setStepWorkflowActive}
        />
      </RightPanelDock>

      {/*
       * Floating mini Mocu cube. Clicking it reveals the
       * Mocu avatar window.
       */}
      <MocuMiniCube />
    </div>
  );

  const renderMainContent = () => {
    switch (activeItem) {
      case 'skills':
        /*
         * Skills are always loaded from the global folder:
         *
         * BaseDirectory.AppData/skills/<skill-folder>/SKILL.md
         */
        return <SkillsPage />;

      case 'schedule':
        return <SchedulePage />;

      case 'docs':
        return <DocsPage />;

      case 'extensions':
        return (
          <ExtensionsPage />
        );

      case 'mcp':
        return (
          <McpPage />
        );

      case 'agents':
        return <AgentsPage />;

      case 'settings':
        /*
         * Real settings page. It renders inside the chat window;
         * there is no separate settings window anymore.
         */
        return (
          <Settings
            onClose={() => {
              setActiveItem('new-chat');
              setIsChatsOpen(false);
              setIsProjectsOpen(false);
            }}
          />
        );

      case 'new-chat':
      case 'chats':
      case 'projects':
      default:
        return renderConversation();
    }
  };

  return (
    <div className="chat-page">
      <ChatSidebar
        activeItem={activeItem}
        activeChatId={activeChatId}
        isChatsOpen={isChatsOpen}
        isProjectsOpen={
          isProjectsOpen
        }
        hasProjectFolder={
          hasProjectFolder
        }
        chats={regularChats}
        projects={projectChats}
        onSelect={
          handleSidebarSelect
        }
        onSelectChat={
          handleSelectRecentChat
        }
        onToggleChats={
          handleToggleChats
        }
        onToggleProjects={
          handleToggleProjects
        }
        onDeleteChat={
          handleDeleteChat
        }
      />

      <main className="chat-main">
        {scheduleNotice ? (
          <div
            className={`chat-schedule-notice chat-schedule-notice-${scheduleNotice.kind} ${scheduleNotice.status === 'failed' ? 'chat-schedule-notice-failed' : ''}`}
            role="status"
          >
            <span className="chat-schedule-notice-icon" aria-hidden="true">
              {scheduleNotice.kind === 'agent' ? <Bot size={17} /> : <BellRing size={17} />}
            </span>
            <span className="chat-schedule-notice-copy">
              <strong>
                {scheduleNotice.kind === 'agent'
                  ? scheduleNotice.status === 'failed'
                    ? 'Scheduled agent failed'
                    : 'Scheduled agent completed'
                  : 'Scheduled reminder'}
              </strong>
              <span>
                <b>{scheduleNotice.title}</b>
                {scheduleNotice.message ? ` — ${scheduleNotice.message}` : ''}
              </span>
            </span>
            <button
              type="button"
              className="chat-schedule-notice-close"
              onClick={() => setScheduleNotice(null)}
              aria-label="Dismiss schedule notification"
              title="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        ) : null}
        {renderMainContent()}
      </main>
    </div>
  );
}

export default ChatPage;