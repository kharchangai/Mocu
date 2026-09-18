import {
  useCallback,
  useMemo,
  useState,
} from 'react';

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

import {
  SkillsPage,
} from './components/skills/SkillsPage';

import {
  Settings,
} from '../components/Settings';

import {
  MocuMiniCube,
} from './components/MocuMiniCube';

import {
  ExtensionsPage,
} from '../extensions/components/ExtensionsPage';

import { AgentsPage } from './components/agents/AgentsPage';

import {
  useChatHistory,
  type EnsureChatResult,
} from './hooks/useChatHistory';

import type {
  ChatMessage,
  RecentChat,
} from './types/chat';

import './ChatPage.css';

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

  const renderPlaceholderPage = (
    title: string,
    description: string,
  ) => (
    <section className="chat-placeholder-page">
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );

  const renderConversation = () => (
    <>
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

      {/*
       * Floating mini Mocu cube. Clicking it reveals the
       * Mocu avatar window.
       */}
      <MocuMiniCube />
    </>
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

      case 'extensions':
        return (
          <ExtensionsPage />
        );

      case 'mcp':
        return renderPlaceholderPage(
          'MCP',
          'Browse and manage MCP connections here.',
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
        {renderMainContent()}
      </main>
    </div>
  );
}

export default ChatPage;