import type { GeneratedChatAudio } from '../types/generatedAudio';

const audioByChat = new Map<string, GeneratedChatAudio[]>();
const audioById = new Map<string, GeneratedChatAudio>();
const EMPTY_AUDIO: GeneratedChatAudio[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('mocu_generated_audio', (event) => {
    const detail = (event as CustomEvent<GeneratedChatAudio & { chatId?: string }>).detail;
    const chatId = detail?.chatId?.trim();
    if (!detail?.id || !detail.path) return;

    const audio: GeneratedChatAudio = {
      id: detail.id,
      name: detail.name,
      mimeType: detail.mimeType,
      path: detail.path,
      text: detail.text ?? '',
    };
    audioById.set(audio.id, audio);
    if (!chatId) {
      notify();
      return;
    }

    const current = audioByChat.get(chatId) ?? [];
    if (current.some((item) => item.id === audio.id)) return;
    audioByChat.set(chatId, [...current, audio]);
    notify();
  });
}

export function getGeneratedAudio(chatId: string | null): GeneratedChatAudio[] {
  return chatId ? audioByChat.get(chatId) ?? EMPTY_AUDIO : EMPTY_AUDIO;
}

export function getGeneratedAudioById(id: string): GeneratedChatAudio | undefined {
  return audioById.get(id);
}

export function subscribeGeneratedAudio(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function takeGeneratedAudio(chatId: string): GeneratedChatAudio[] {
  const audio = audioByChat.get(chatId) ?? EMPTY_AUDIO;
  audioByChat.delete(chatId);
  notify();
  return audio;
}