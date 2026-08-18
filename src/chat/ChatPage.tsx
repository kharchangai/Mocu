// src/chat/ChatPage.tsx

import { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';

import {
  ChatSidebar,
  type ChatSidebarItemId,
} from './components/ChatSidebar';

import { ChatBox } from './components/ChatBox';
import {
  useChatHistory,
  type EnsureChatResult,
} from './hooks/useChatHistory';

import type { ChatMessage } from './types/chat';

import './ChatPage.css';

function ChatPage() {
  const [activeItem, setActiveItem] =
    useState<ChatSidebarItemId>('new-chat');

  /*
   * True while the active conversation was loaded from a project's
   * persisted history. Keeps the Chats item highlighted when a loaded
   * project conversation is displayed.
   */
  const [isLoadedProjectConversation, setIsLoadedProjectConversation] =
    useState(false);

  /*
   * Whether the saved chats accordion below the Chats sidebar item is
   * expanded. Clicking Chats toggles this list instead of opening a
   * separate Chats page.
   */
  const [isChatsOpen, setIsChatsOpen] = useState(false);

  /*
   * This path is used as the default project path for new chats.
   * Existing chats keep their own project path in chat history.
   */
  const [defaultProjectPath, setDefaultProjectPath] =
    useState('');

  const {
    activeChat,
    activeChatId,
    recentChats,
    startNewChat,
    selectChat,
    ensureChat,
    loadProjectConversation,
    appendMessage,
    updateChatProjectPath,
    deleteChat,
  } = useChatHistory();

  /*
   * Use the project path stored for the active chat.
   * A new chat uses the current default project path.
   */
  const currentProjectPath =
    activeChat?.projectPath ?? defaultProjectPath;

  const handleProjectPathChange = useCallback(
    (newProjectPath: string): void => {
      setDefaultProjectPath(newProjectPath);

      if (activeChatId) {
        updateChatProjectPath(
          activeChatId,
          newProjectPath,
        );
      }
    },
    [activeChatId, updateChatProjectPath],
  );

  const handleProjectFolderSelected = useCallback(
    async (folderPath: string): Promise<void> => {
      handleProjectPathChange(folderPath);

      /*
       * A selected project folder may already contain a persisted
       * conversation in .mocu/memory/chat.json. Load it, activate it,
       * and display it so the user can continue where they left off.
       */
      const loadedConversation = await loadProjectConversation(
        folderPath,
      );

      if (loadedConversation) {
        setIsLoadedProjectConversation(true);
        setActiveItem('new-chat');

        console.log(
          '[Chat Page] Resumed project conversation:',
          loadedConversation.id,
        );

        return;
      }

      /*
       * No existing history for this folder: stay on New Chat so the
       * user can start a brand-new conversation.
       */
      setIsLoadedProjectConversation(false);
      setActiveItem('new-chat');
    },
    [handleProjectPathChange, loadProjectConversation],
  );

  const handleChooseProjectFolder =
    useCallback(async (): Promise<void> => {
      try {
        const selectedFolder = await open({
          directory: true,
          multiple: false,
          title: 'Choose a project folder',
        });

        /*
         * The user closed the dialog without selecting
         * a directory.
         */
        if (selectedFolder === null) {
          return;
        }

        /*
         * Tauri normally returns a string when multiple is false.
         * The array check keeps this code safe across versions.
         */
        const folderPath = Array.isArray(selectedFolder)
          ? selectedFolder[0]
          : selectedFolder;

        if (
          typeof folderPath !== 'string' ||
          folderPath.trim() === ''
        ) {
          return;
        }

        const normalizedFolderPath = folderPath.trim();

        await handleProjectFolderSelected(normalizedFolderPath);

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
    }, [handleProjectFolderSelected]);

  const handleSidebarSelect = useCallback(
    (item: ChatSidebarItemId): void => {
      if (item === 'new-chat') {
        /*
         * New chat starts a blank conversation: clear the active
         * chat, the default project folder, and collapse the saved
         * chats accordion so the sidebar starts fresh.
         * A chat record will be created after the user sends
         * the first message.
         */
        startNewChat();
        setIsLoadedProjectConversation(false);
        setDefaultProjectPath('');
        setIsChatsOpen(false);
      }

      if (item === 'chats') {
        /*
         * Chats only toggles the saved conversation list directly
         * below the Chats item. No separate Chats page is opened
         * and the current conversation stays untouched.
         */
        setIsChatsOpen((current) => !current);
        return;
      }

      setActiveItem(item);
    },
    [startNewChat],
  );

  const handleToggleChats = useCallback((): void => {
    handleSidebarSelect('chats');
  }, [handleSidebarSelect]);

  const handleSelectRecentChat = useCallback(
    (chatId: string): void => {
      /*
       * Select the saved conversation as-is: no new chat record or
       * history file is created. The conversation UI is displayed in
       * the main panel and the chat keeps its own project path.
       */
      selectChat(chatId);

      /*
       * Picking a conversation from the list is not the same as
       * loading a project conversation, so keep the default
       * navigation highlight.
       */
      setIsLoadedProjectConversation(false);

      setActiveItem('new-chat');
    },
    [selectChat],
  );

  const handleEnsureChat = useCallback(
    async (
      firstMessage: string,
      projectPath: string,
      initialHistory?: ChatMessage[],
    ): Promise<EnsureChatResult> => {
      const result = await ensureChat(
        firstMessage,
        projectPath,
        initialHistory ?? [],
      );

      /*
       * A brand-new conversation is not a resumed project
       * conversation, so keep the New chat tab highlighted.
       */
      if (result.wasCreated) {
        setIsLoadedProjectConversation(false);
      }

      /*
       * Keep the conversation interface visible after creating
       * the first chat.
       */
      setActiveItem('new-chat');

      return result;
    },
    [ensureChat],
  );

  const handleDeleteChat = useCallback(
    (chatId: string): void => {
      deleteChat(chatId);

      /*
       * Return to an empty new-chat screen if the currently
       * opened conversation is deleted.
       */
      if (chatId === activeChatId) {
        setActiveItem('new-chat');
      }
    },
    [activeChatId, deleteChat],
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

  const renderMainContent = () => {
    if (activeItem === 'extensions') {
      return renderPlaceholderPage(
        'Extensions',
        'Browse and manage Mocu extensions here.',
      );
    }

    if (activeItem === 'settings') {
      return renderPlaceholderPage(
        'Settings',
        'Chat preferences and model settings will appear here.',
      );
    }

    /*
     * New chat, saved chats, and every other state render the
     * conversation panel. Saved chats are opened in place by
     * selecting them from the sidebar accordion.
     */
    return (
      <>
        <header className="chat-header">
          <span className="chat-header-title">
            {activeChat?.title ?? 'New chat'}
          </span>
        </header>

        <ChatBox
          chatId={activeChatId}
          messages={activeChat?.messages ?? []}
          agentName="Mocu"
          projectPath={currentProjectPath}
          onEnsureChat={handleEnsureChat}
          onAppendMessage={appendMessage}
          onProjectPathChange={
            handleProjectPathChange
          }
          onChooseProjectFolder={
            handleChooseProjectFolder
          }
        />
      </>
    );
  };

  return (
    <div className="chat-page">
      <ChatSidebar
        activeItem={activeItem}
        activeChatId={activeChatId}
        isChatsOpen={isChatsOpen}
        isLoadedProjectConversation={isLoadedProjectConversation}
        chats={recentChats}
        onSelect={handleSidebarSelect}
        onSelectChat={handleSelectRecentChat}
        onToggleChats={handleToggleChats}
        onDeleteChat={handleDeleteChat}
      />

      <main className="chat-main">
        {renderMainContent()}
      </main>
    </div>
  );
}

export default ChatPage;
