import type { ReactNode } from 'react';

import { confirm } from '@tauri-apps/plugin-dialog';

import type { RecentChat } from '../types/chat';

export type ChatSidebarItemId =
  | 'new-chat'
  | 'chats'
  | 'projects'
  | 'skills'
  | 'extensions'
  | 'mcp'
  | 'agents'
  | 'settings';

type ChatSidebarProps = {
  activeItem: ChatSidebarItemId;
  activeChatId: string | null;
  isChatsOpen: boolean;
  isProjectsOpen: boolean;
  hasProjectFolder: boolean;
  chats: RecentChat[];
  projects: RecentChat[];
  onSelect: (item: ChatSidebarItemId) => void;
  onSelectChat: (chatId: string) => void;
  onToggleChats: () => void;
  onToggleProjects: () => void;
  onDeleteChat?: (chatId: string) => void;
};

type NavButtonProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  expanded?: boolean;
  endIcon?: ReactNode;
  onClick: () => void;
};

function NavButton({
  icon,
  label,
  active = false,
  expanded,
  endIcon,
  onClick,
}: NavButtonProps) {
  return (
    <button
      type="button"
      className={`chat-sidebar-item ${
        active ? 'chat-sidebar-item-active' : ''
      }`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
    >
      <span
        className="chat-sidebar-item-icon"
        aria-hidden="true"
      >
        {icon}
      </span>

      <span className="chat-sidebar-item-label">
        {label}
      </span>

      {endIcon ? (
        <span
          className="chat-sidebar-item-end-icon"
          aria-hidden="true"
        >
          {endIcon}
        </span>
      ) : null}
    </button>
  );
}

/*
 * Renders one saved conversation list. Shared by the Chats and
 * Projects sections so both accordions behave identically.
 */
type ChatListProps = {
  chats: RecentChat[];
  activeChatId: string | null;
  emptyLabel: string;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (
    chatId: string,
    chatTitle: string,
  ) => void | Promise<void>;
};

function ChatList({
  chats,
  activeChatId,
  emptyLabel,
  onSelectChat,
  onDeleteChat,
}: ChatListProps) {
  if (chats.length === 0) {
    return (
      <p className="chat-sidebar-chats-empty">
        {emptyLabel}
      </p>
    );
  }

  return (
    <>
      {chats.map((chat) => (
        <div
          key={chat.id}
          className={`chat-sidebar-chat-item ${
            activeChatId === chat.id
              ? 'chat-sidebar-chat-item-active'
              : ''
          }`}
        >
          <button
            type="button"
            className="chat-sidebar-chat-open"
            onClick={() => onSelectChat(chat.id)}
            title={chat.title}
            aria-current={
              activeChatId === chat.id
                ? 'page'
                : undefined
            }
          >
            {chat.title}
          </button>

          <button
            type="button"
            className="chat-sidebar-chat-more"
            onClick={() =>
              void onDeleteChat(chat.id, chat.title)
            }
            aria-label={`Delete ${chat.title}`}
            title="Delete chat"
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v5" />
              <path d="M14 11v5" />
            </svg>
          </button>
        </div>
      ))}
    </>
  );
}

export function ChatSidebar({
  activeItem,
  activeChatId,
  isChatsOpen,
  isProjectsOpen,
  hasProjectFolder,
  chats,
  projects,
  onSelect,
  onSelectChat,
  onToggleChats,
  onToggleProjects,
  onDeleteChat,
}: ChatSidebarProps) {
  /*
   * window.confirm is not supported inside the Tauri webview, so the
   * dialog plugin's native confirm is used instead.
   */
  const handleDeleteChat = async (
    chatId: string,
    chatTitle: string,
  ) => {
    if (!onDeleteChat) {
      return;
    }

    const shouldDelete = await confirm(
      `Delete "${chatTitle}"?`,
      {
        title: 'Delete chat',
        kind: 'warning',
      },
    );

    if (shouldDelete) {
      onDeleteChat(chatId);
    }
  };

  /*
   * The active section between Chats and Projects follows the current
   * conversation: when a project folder is selected the Projects tab
   * is highlighted, otherwise the Chats tab remains highlighted.
   */
  const isProjectFolderActive =
    activeItem === 'new-chat' && hasProjectFolder;

  /*
   * The Chats tab is active while its accordion is open or when the
   * current new conversation has no selected project folder.
   */
  const isChatsButtonActive =
    isChatsOpen ||
    (activeItem === 'new-chat' && !hasProjectFolder);

  /*
   * The Projects tab is active while its accordion is open or when the
   * current new conversation has a selected project folder.
   */
  const isProjectsButtonActive =
    isProjectsOpen || isProjectFolderActive;

  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-top">
        <button
          type="button"
          className="chat-sidebar-brand"
          onClick={() => onSelect('new-chat')}
          aria-label="Mocu home"
        >
          <span className="chat-sidebar-logo">M</span>

          <span className="chat-sidebar-brand-name">
            Mocu
          </span>
        </button>

        <button
          type="button"
          className="chat-sidebar-icon-button"
          aria-label="Search chats"
          title="Search chats"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </div>

      <nav
        className="chat-sidebar-main-nav"
        aria-label="Main navigation"
      >
        <NavButton
          label="New chat"
          active={
            activeItem === 'new-chat' &&
            activeChatId === null
          }
          onClick={() => onSelect('new-chat')}
          icon={
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          }
        />

        <div className="chat-sidebar-chats-group">
          <NavButton
            label="Chats"
            active={isChatsButtonActive}
            expanded={isChatsOpen}
            onClick={onToggleChats}
            endIcon={
              <svg
                className={`chat-sidebar-chevron ${
                  isChatsOpen
                    ? 'chat-sidebar-chevron--open'
                    : ''
                }`}
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            }
            icon={
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            }
          />

          {isChatsOpen ? (
            <div className="chat-sidebar-chats-list">
              <ChatList
                chats={chats}
                activeChatId={activeChatId}
                emptyLabel="No conversations yet"
                onSelectChat={onSelectChat}
                onDeleteChat={handleDeleteChat}
              />
            </div>
          ) : null}
        </div>

        <div className="chat-sidebar-chats-group">
          <NavButton
            label="Projects"
            active={isProjectsButtonActive}
            expanded={isProjectsOpen}
            onClick={onToggleProjects}
            endIcon={
              <svg
                className={`chat-sidebar-chevron ${
                  isProjectsOpen
                    ? 'chat-sidebar-chevron--open'
                    : ''
                }`}
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            }
            icon={
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
            }
          />

          {isProjectsOpen ? (
            <div className="chat-sidebar-chats-list">
              <ChatList
                chats={projects}
                activeChatId={activeChatId}
                emptyLabel="No projects yet"
                onSelectChat={onSelectChat}
                onDeleteChat={handleDeleteChat}
              />
            </div>
          ) : null}
        </div>

        <NavButton
          label="Skills"
          active={activeItem === 'skills'}
          onClick={() => onSelect('skills')}
          icon={
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3 14.2 8.1 20 9l-4.2 4.1 1 5.8L12 16.2 7.2 19l1-5.9L4 9l5.8-.9Z" />
              <path d="M9.5 12 11 13.5 14.5 10" />
            </svg>
          }
        />

        <NavButton
          label="Extensions"
          active={activeItem === 'extensions'}
          onClick={() => onSelect('extensions')}
          icon={
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8.5 3.5h-2a3 3 0 0 0-3 3v2a2.5 2.5 0 1 1 0 5v4a3 3 0 0 0 3 3h4v-1a2.5 2.5 0 1 1 5 0v1h2a3 3 0 0 0 3-3v-4h-1a2.5 2.5 0 1 1 0-5h1v-2a3 3 0 0 0-3-3h-4a2.5 2.5 0 1 1-5 0Z" />
            </svg>
          }
        />

        <NavButton
          label="MCP"
          active={activeItem === 'mcp'}
          onClick={() => onSelect('mcp')}
          icon={
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 13V6a2 2 0 0 1 2-2h4" />
              <path d="M4 13h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4z" />
              <path d="M20 13V8a2 2 0 0 0-2-2h-4" />
              <path d="M20 13h-4a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h4z" />
              <path d="M5 17v3" />
              <path d="M19 17v3" />
              <path d="M5 20h14" />
            </svg>
          }
        />

        <NavButton
          label="Agents"
          active={activeItem === 'agents'}
          onClick={() => onSelect('agents')}
          icon={
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              <path d="m15.5 6.5 1 1 2-2" />
            </svg>
          }
        />
      </nav>

      <div className="chat-sidebar-footer">
        <NavButton
          label="Settings"
          active={activeItem === 'settings'}
          onClick={() => onSelect('settings')}
          icon={
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />

              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 2-.06-.06A1.7 1.7 0 0 0 15.86 18a1.7 1.7 0 0 0-1.02 1.56V20h-2.8v-.44A1.7 1.7 0 0 0 11.02 18a1.7 1.7 0 0 0-1.88.34l-.06.06-2-2 .06-.06A1.7 1.7 0 0 0 8 15.86 1.7 1.7 0 0 0 6.44 14.84H6v-2.8h.44A1.7 1.7 0 0 0 8 11.02a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2-2 .06.06A1.7 1.7 0 0 0 11.54 8 1.7 1.7 0 0 0 12.56 6.44V6h2.8v.44A1.7 1.7 0 0 0 16.38 8a1.7 1.7 0 0 0 1.88-.34l.06-.06 2 2-.06.06A1.7 1.7 0 0 0 19.4 11.54a1.7 1.7 0 0 0 1.56 1.02H21v2.8h-.44A1.7 1.7 0 0 0 19.4 15z" />
            </svg>
          }
        />
      </div>
    </aside>
  );
}