export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  projectPath: string;
  historyFilePath: string;
  createdAt: string;
  updatedAt: string;
};

export type RecentChat = {
  id: string;
  title: string;
};