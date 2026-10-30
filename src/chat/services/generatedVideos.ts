import type { GeneratedChatVideo } from '../types/generatedVideo';

const videosByChat = new Map<string, GeneratedChatVideo[]>();
const EMPTY_VIDEOS: GeneratedChatVideo[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('mocu_generated_video', (event) => {
    const detail = (event as CustomEvent<GeneratedChatVideo & { chatId?: string }>).detail;
    const chatId = detail?.chatId?.trim();
    if (!chatId || !detail.id || !detail.path) return;
    const current = videosByChat.get(chatId) ?? [];
    if (current.some((video) => video.id === detail.id)) return;
    videosByChat.set(chatId, [...current, {
      id: detail.id,
      name: detail.name,
      mimeType: detail.mimeType,
      path: detail.path,
    }]);
    notify();
  });
}

export function getGeneratedVideos(chatId: string | null): GeneratedChatVideo[] {
  return chatId ? videosByChat.get(chatId) ?? EMPTY_VIDEOS : EMPTY_VIDEOS;
}

export function subscribeGeneratedVideos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function takeGeneratedVideos(chatId: string): GeneratedChatVideo[] {
  const videos = videosByChat.get(chatId) ?? EMPTY_VIDEOS;
  videosByChat.delete(chatId);
  notify();
  return videos;
}
