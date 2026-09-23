import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { createPortal } from 'react-dom';

import { confirm } from '@tauri-apps/plugin-dialog';

import type { RecentChat } from '../types/chat';
import type { ProjectWorkspace } from '../services/projectWorkspaces';
import { listAvailableAgents, type AvailableAgent } from '../agent/agent-loader';
import { useRunningChatIds } from '../services/chatRuns';

export type ChatSidebarItemId =
  | 'home'
  | 'new-chat'
  | 'chats'
  | 'projects'
  | 'skills'
  | 'schedule'
  | 'docs'
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
  projects: ProjectWorkspace[];
  onSelect: (item: ChatSidebarItemId) => void;
  onSelectChat: (chatId: string) => void;
  onSelectProject: (path: string) => void;
  onDeleteProject: (path: string, deleteFolder: boolean) => Promise<void>;
  onToggleChats: () => void;
  onToggleProjects: () => void;
  onDeleteChat?: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
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

/* Renders the saved conversations under the Chats accordion. */
type ChatListProps = {
  chats: RecentChat[];
  activeChatId: string | null;
  emptyLabel: string;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (
    chatId: string,
    chatTitle: string,
  ) => void | Promise<void>;
  onRenameChat: (chatId: string, title: string) => void;
};

function ChatList({
  chats,
  activeChatId,
  emptyLabel,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
}: ChatListProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  /*
   * Chats whose agent is currently running in the background. Each chat
   * shows a small live dot, so conversations working in parallel are
   * visible at a glance even while another chat is open.
   */
  const runningChatIds = useRunningChatIds();

  const startRenaming = (chatId: string, title: string) => {
    setEditingChatId(chatId);
    setEditingTitle(title);
  };

  const cancelRenaming = () => {
    setEditingChatId(null);
    setEditingTitle('');
  };

  const saveRename = (chatId: string) => {
    const title = editingTitle.replace(/\s+/g, ' ').trim();
    if (!title) return;
    onRenameChat(chatId, title);
    cancelRenaming();
  };
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
          {editingChatId === chat.id ? (
            <form
              className="chat-sidebar-chat-edit-form"
              onSubmit={(event) => {
                event.preventDefault();
                saveRename(chat.id);
              }}
            >
              <input
                autoFocus
                className="chat-sidebar-chat-edit-input"
                value={editingTitle}
                onChange={(event) => setEditingTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelRenaming();
                  }
                }}
                aria-label={`Rename ${chat.title}`}
                maxLength={120}
              />
              <span className="chat-sidebar-chat-edit-actions">
                <button
                  type="submit"
                  className="chat-sidebar-chat-action chat-sidebar-chat-action-save"
                  disabled={!editingTitle.trim()}
                  aria-label="Save chat name"
                  title="Save"
                >
                  <Check size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-sidebar-chat-action"
                  onClick={cancelRenaming}
                  aria-label="Cancel renaming"
                  title="Cancel"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            </form>
          ) : (
            <>
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
                {runningChatIds.includes(chat.id) ? (
                  <span
                    className="chat-sidebar-chat-running"
                    aria-hidden="true"
                    title="Mocu is still working on this chat"
                  />
                ) : null}
                {chat.title}
              </button>

              <span className="chat-sidebar-chat-actions">
                <button
                  type="button"
                  className="chat-sidebar-chat-action"
                  onClick={() => startRenaming(chat.id, chat.title)}
                  aria-label={`Rename ${chat.title}`}
                  title="Rename chat"
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chat-sidebar-chat-action chat-sidebar-chat-delete"
                  onClick={() => void onDeleteChat(chat.id, chat.title)}
                  aria-label={`Delete ${chat.title}`}
                  title="Delete chat"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </span>
            </>
          )}
        </div>
      ))}
    </>
  );
}

function ProjectDeleteDialog({
  project,
  onCancel,
  onConfirm,
}: {
  project: ProjectWorkspace;
  onCancel: () => void;
  onConfirm: (deleteFolder: boolean) => Promise<void>;
}) {
  const [deleteFolder, setDeleteFolder] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    cancelButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        event.preventDefault();
        onCancel();
        return;
      }

      if (event.key === 'Tab') {
        if (isDeleting) {
          event.preventDefault();
          return;
        }

        const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>(
          'button:not([disabled])',
        );
        if (!buttons?.length) return;

        const firstButton = buttons[0];
        const lastButton = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === firstButton) {
          event.preventDefault();
          lastButton.focus();
        } else if (!event.shiftKey && document.activeElement === lastButton) {
          event.preventDefault();
          firstButton.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDeleting, onCancel]);

  const handleConfirm = async () => {
    setIsDeleting(true);
    setDeleteError('');
    try {
      await onConfirm(deleteFolder);
    } catch (error) {
      console.error('[Projects] Failed to remove project:', error);
      setDeleteError(
        error instanceof Error ? error.message : 'Could not remove the project.',
      );
      setIsDeleting(false);
    }
  };

  return createPortal(
    <div
      className="project-delete-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="project-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="project-delete-title"
        aria-describedby="project-delete-description"
      >
        <button
          type="button"
          className="project-delete-close"
          onClick={onCancel}
          aria-label="Cancel project removal"
          disabled={isDeleting}
        >
          <X size={17} aria-hidden="true" />
        </button>

        <div className="project-delete-icon" aria-hidden="true">
          <AlertTriangle size={21} />
        </div>
        <p className="project-delete-eyebrow">PROJECT REMOVAL</p>
        <h2 id="project-delete-title">Remove {project.name}?</h2>
        <p className="project-delete-description" id="project-delete-description">
          This removes the project and its saved Mocu conversation data. You can
          also choose to permanently delete the project folder below.
        </p>

        <div className="project-delete-summary">
          <span className="project-delete-folder-icon" aria-hidden="true">
            <FolderOpen size={17} />
          </span>
          <span className="project-delete-project-copy">
            <strong>{project.name}</strong>
            <small title={project.path}>{project.path}</small>
          </span>
        </div>

        <div className="project-delete-notice">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>The saved Mocu conversation cannot be restored after removal.</span>
        </div>

        <label
          className={`project-delete-folder-option ${
            deleteFolder ? 'project-delete-folder-option-checked' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={deleteFolder}
            onChange={(event) => setDeleteFolder(event.target.checked)}
            disabled={isDeleting}
          />
          <span className="project-delete-folder-option-copy">
            <strong>Also delete the project folder</strong>
            <small>Permanently remove its files from your device.</small>
          </span>
        </label>

        {deleteFolder ? (
          <div className="project-delete-folder-warning">
            <AlertTriangle size={15} aria-hidden="true" />
            <span>
              This permanently deletes the folder and everything inside it:
              <strong title={project.path}>{project.path}</strong>
            </span>
          </div>
        ) : null}

        {deleteError ? (
          <p className="project-delete-error" role="alert">{deleteError}</p>
        ) : null}

        <footer className="project-delete-actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="project-delete-cancel"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Keep project
          </button>
          <button
            type="button"
            className="project-delete-confirm"
            onClick={() => void handleConfirm()}
            disabled={isDeleting}
          >
            <Trash2 size={15} aria-hidden="true" />
            {isDeleting
              ? 'Removing…'
              : deleteFolder
                ? 'Delete folder & project'
                : 'Remove project'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ProjectList({
  projects,
  onSelectProject,
  onDeleteProject,
}: {
  projects: ProjectWorkspace[];
  onSelectProject: (path: string) => void;
  onDeleteProject: (path: string, deleteFolder: boolean) => Promise<void>;
}) {
  const [projectToDelete, setProjectToDelete] = useState<
    ProjectWorkspace | null
  >(null);

  const cancelProjectRemoval = useCallback(() => {
    setProjectToDelete(null);
  }, []);

  const confirmProjectRemoval = useCallback(
    async (deleteFolder: boolean) => {
      if (!projectToDelete) return;
      await onDeleteProject(projectToDelete.path, deleteFolder);
      setProjectToDelete(null);
    },
    [onDeleteProject, projectToDelete],
  );

  if (projects.length === 0) {
    return <p className="chat-sidebar-chats-empty">No projects yet</p>;
  }

  return (
    <>
      <div className="chat-sidebar-project-list">
        {projects.map((project) => (
          <div className="chat-sidebar-project-row" key={project.path}>
            <button
              type="button"
              className="chat-sidebar-project-open"
              title={project.path}
              onClick={() => onSelectProject(project.path)}
            >
              <span className="chat-sidebar-project-icon" aria-hidden="true">
                <Folder size={14} />
              </span>
              <span>{project.name}</span>
            </button>
            <button
              type="button"
              className="chat-sidebar-project-delete"
              onClick={() => setProjectToDelete(project)}
              aria-label={`Remove ${project.name} from Mocu`}
              title="Remove project"
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {projectToDelete ? (
        <ProjectDeleteDialog
          project={projectToDelete}
          onCancel={cancelProjectRemoval}
          onConfirm={confirmProjectRemoval}
        />
      ) : null}
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
  onSelectProject,
  onDeleteProject,
  onToggleChats,
  onToggleProjects,
  onDeleteChat,
  onRenameChat,
}: ChatSidebarProps) {
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>([]);

  useEffect(() => {
    void listAvailableAgents()
      .then(setAvailableAgents)
      .catch((error) => {
        console.error('[Chat Sidebar] Failed to load agents:', error);
        setAvailableAgents([]);
      });
  }, []);

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
          onClick={() => onSelect('home')}
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
          label="Home"
          active={activeItem === 'home'}
          onClick={() => onSelect('home')}
          icon={
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m3 10 9-7 9 7" />
              <path d="M5 9v11h14V9M9 20v-7h6v7" />
            </svg>
          }
        />

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
                onRenameChat={onRenameChat}
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
              <ProjectList
                projects={projects}
                onSelectProject={onSelectProject}
                onDeleteProject={onDeleteProject}
              />
            </div>
          ) : null}
        </div>

        <NavButton
          label="Schedule"
          active={activeItem === 'schedule'}
          onClick={() => onSelect('schedule')}
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
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
              <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
            </svg>
          }
        />

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
          label="Docs"
          active={activeItem === 'docs'}
          onClick={() => onSelect('docs')}
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
              <path d="M6 3h9l4 4v14H6z" />
              <path d="M15 3v4h4" />
              <path d="M9 12h7M9 16h7M9 8h2" />
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

        {activeItem === 'agents' ? (
          <div className="chat-sidebar-agent-list" aria-label="Available agents">
            {availableAgents.length === 0 ? (
              <p className="chat-sidebar-chats-empty">No saved agents</p>
            ) : (
              availableAgents.map((agent) => (
                <div className="chat-sidebar-agent-item" key={agent.path} title={agent.description}>
                  <span className="chat-sidebar-agent-dot" aria-hidden="true" />
                  <span>{agent.agentName}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
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