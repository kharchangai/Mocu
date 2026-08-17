// src/chat/ChatPage.tsx
import { useState } from 'react';

import {
  ChatSidebar,
  type ChatSidebarItemId,
  type RecentChat,
} from './components/ChatSidebar';
import { ChatBox } from './components/ChatBox';

import './ChatPage.css';

// Sample data until real chat storage is connected.
const recentChats: RecentChat[] = [
  { id: 'chat-01', title: 'Long-term memory architecture' },
  { id: 'chat-02', title: 'Tauri fullscreen window setup' },
  { id: 'chat-03', title: 'Chat sidebar design' },
  { id: 'chat-04', title: 'Embedding pipeline costs' },
  { id: 'chat-05', title: 'Scientific article translation' },
  { id: 'chat-06', title: 'Weekly project planning' },
  { id: 'chat-07', title: 'Extension system ideas' },
  { id: 'chat-08', title: 'Feedback gate prototype' },
];

function ChatPage() {
  const [activeItem, setActiveItem] =
    useState<ChatSidebarItemId>('new-chat');
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const activeChat =
    recentChats.find((chat) => chat.id === activeChatId) ?? null;

  const handleSidebarSelect = (item: ChatSidebarItemId) => {
    if (item === 'new-chat') {
      setActiveChatId(null);
    }

    setActiveItem(item);
  };

  const handleSelectRecentChat = (chatId: string) => {
    setActiveChatId(chatId);
    setActiveItem('new-chat');
  };

  const renderPlaceholderPage = (title: string, description: string) => (
    <section className="chat-placeholder-page">
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );

  const renderMainContent = () => {
    if (activeItem === 'chats') {
      return renderPlaceholderPage(
        'Chats',
        'All of your saved conversations will appear here.',
      );
    }

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

    // The whole chat section is just this one component.
    return (
      <>
        <header className="chat-header">
          <span className="chat-header-title">
            {activeChat ? activeChat.title : 'New chat'}
          </span>
        </header>

        <ChatBox key={activeChatId ?? 'new-chat'} />
      </>
    );
  };

  return (
    <div className="chat-page">
      <ChatSidebar
        activeItem={activeItem}
        activeChatId={activeChatId}
        recentChats={recentChats}
        onSelect={handleSidebarSelect}
        onSelectChat={handleSelectRecentChat}
      />

      <div className="chat-main">{renderMainContent()}</div>
    </div>
  );
}

export default ChatPage;