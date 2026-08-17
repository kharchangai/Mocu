// src/chat/components/ChatSidebar.tsx

export type ChatSidebarItemId =
  | 'new-chat'
  | 'chats'
  | 'extensions'
  | 'settings';

export type RecentChat = {
  id: string;
  title: string;
};

type ChatSidebarProps = {
  activeItem: ChatSidebarItemId;
  activeChatId: string | null;
  recentChats: RecentChat[];
  onSelect: (item: ChatSidebarItemId) => void;
  onSelectChat: (chatId: string) => void;
};

type NavButtonProps = {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
};

function NavButton({ icon, label, active = false, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      className={`chat-sidebar-item ${active ? 'chat-sidebar-item-active' : ''}`}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="chat-sidebar-item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="chat-sidebar-item-label">{label}</span>
    </button>
  );
}

export function ChatSidebar({
  activeItem,
  activeChatId,
  recentChats,
  onSelect,
  onSelectChat,
}: ChatSidebarProps) {
  return (
    <aside className="chat-sidebar">
      {/* Brand + search */}
      <div className="chat-sidebar-top">
        <button
          type="button"
          className="chat-sidebar-brand"
          onClick={() => onSelect('new-chat')}
          aria-label="Mocu home"
        >
          <span className="chat-sidebar-logo">M</span>
          <span className="chat-sidebar-brand-name">Mocu</span>
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

      {/* Primary navigation */}
      <nav className="chat-sidebar-main-nav" aria-label="Main navigation">
        <NavButton
          label="New chat"
          active={activeItem === 'new-chat' && activeChatId === null}
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
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          }
        />

        <NavButton
          label="Chats"
          active={activeItem === 'chats'}
          onClick={() => onSelect('chats')}
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
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
            >
              <path d="M8.5 3.5h-2a3 3 0 0 0-3 3v2a2.5 2.5 0 1 1 0 5v4a3 3 0 0 0 3 3h4v-1a2.5 2.5 0 1 1 5 0v1h2a3 3 0 0 0 3-3v-4h-1a2.5 2.5 0 1 1 0-5h1v-2a3 3 0 0 0-3-3h-4a2.5 2.5 0 1 1-5 0Z" />
            </svg>
          }
        />
      </nav>

      {/* Recent conversations */}
      <div className="chat-sidebar-recents">
        <p className="chat-sidebar-recents-label">Recents</p>

        <div className="chat-sidebar-recents-list">
          {recentChats.map((chat) => (
            <div
              key={chat.id}
              className={`chat-sidebar-recent-item ${
                activeChatId === chat.id
                  ? 'chat-sidebar-recent-item-active'
                  : ''
              }`}
            >
              <button
                type="button"
                className="chat-sidebar-recent-open"
                onClick={() => onSelectChat(chat.id)}
                title={chat.title}
              >
                {chat.title}
              </button>

              <button
                type="button"
                className="chat-sidebar-recent-more"
                aria-label={`More options for ${chat.title}`}
                title="More options"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
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
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 2-.06-.06A1.7 1.7 0 0 0 15.86 18a1.7 1.7 0 0 0-1.02 1.56V20h-2.8v-.44A1.7 1.7 0 0 0 11.02 18a1.7 1.7 0 0 0-1.88.34l-.06.06-2-2 .06-.06A1.7 1.7 0 0 0 8 15.86 1.7 1.7 0 0 0 6.44 14.84H6v-2.8h.44A1.7 1.7 0 0 0 8 11.02a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2-2 .06.06A1.7 1.7 0 0 0 11.54 8 1.7 1.7 0 0 0 12.56 6.44V6h2.8v.44A1.7 1.7 0 0 0 16.38 8a1.7 1.7 0 0 0 1.88-.34l.06-.06 2 2-.06.06A1.7 1.7 0 0 0 19.4 11.54a1.7 1.7 0 0 0 1.56 1.02H21v2.8h-.44A1.7 1.7 0 0 0 19.4 15z" />
            </svg>
          }
        />

        <button type="button" className="chat-sidebar-profile">
          <span className="chat-sidebar-profile-avatar">A</span>

          <span className="chat-sidebar-profile-info">
            <span className="chat-sidebar-profile-name">Amin Kiani</span>
            <span className="chat-sidebar-profile-plan">Free plan</span>
          </span>

          <svg
            className="chat-sidebar-profile-chevron"
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
            <path d="m7 15 5 5 5-5" />
            <path d="m7 9 5-5 5 5" />
          </svg>
        </button>
      </div>
    </aside>
  );
}