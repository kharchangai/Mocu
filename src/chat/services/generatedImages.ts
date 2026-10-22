import type { GeneratedChatImage } from '../types/generatedImage';

const imagesByChat = new Map<string, GeneratedChatImage[]>();
const EMPTY_IMAGES: GeneratedChatImage[] = [];
const imageListeners = new Set<() => void>();

function notify(): void {
  for (const listener of imageListeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('mocu_generated_image', (event) => {
    const detail = (event as CustomEvent<GeneratedChatImage & { chatId?: string }>).detail;
    const chatId = detail?.chatId?.trim();
    if (!chatId || !detail.id || !detail.path) return;
    const current = imagesByChat.get(chatId) ?? [];
    if (!current.some((image) => image.id === detail.id)) {
      imagesByChat.set(chatId, [...current, {
        id: detail.id,
        name: detail.name,
        mimeType: detail.mimeType,
        path: detail.path,
      }]);
      notify();
    }
  });
}

export function getGeneratedImages(chatId: string | null): GeneratedChatImage[] {
  return chatId ? imagesByChat.get(chatId) ?? EMPTY_IMAGES : EMPTY_IMAGES;
}

export function subscribeGeneratedImages(listener: () => void): () => void {
  imageListeners.add(listener);
  return () => imageListeners.delete(listener);
}

export function takeGeneratedImages(chatId: string): GeneratedChatImage[] {
  const images = imagesByChat.get(chatId) ?? [];
  imagesByChat.delete(chatId);
  notify();
  return images;
}
