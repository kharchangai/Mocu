import type { ChatImageAttachment } from './imageAttachment';
import type { GeneratedChatImage } from './generatedImage';

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  attachments?: ChatImageAttachment[];
  generatedImages?: GeneratedChatImage[];
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