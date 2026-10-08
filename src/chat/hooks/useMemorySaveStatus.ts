// Tracks concurrent background memory saves per chat, independently by save ID.
import { useEffect, useState } from 'react';
import type { MemorySaveActivity, MemorySaveStatus } from '../services/memoryActivity';

export type MemorySaveItem = {
  saveId: string;
  status: MemorySaveStatus;
  projectPath?: string;
  updatedAt: number;
};

const UNSCOPED_KEY = '__unscoped__';
const savesByChat = new Map<string, Map<string, MemorySaveItem>>();
const listenersByChat = new Map<string, Set<() => void>>();

function chatKey(chatId?: string | null): string {
  return chatId ?? UNSCOPED_KEY;
}

function getSnapshot(key: string): MemorySaveItem[] {
  return Array.from(savesByChat.get(key)?.values() ?? []).sort((a, b) => a.updatedAt - b.updatedAt);
}

function notify(key: string): void {
  for (const listener of listenersByChat.get(key) ?? []) listener();
}

function applyActivity(activity: MemorySaveActivity): void {
  const key = chatKey(activity.chatId);
  let saves = savesByChat.get(key);
  if (!saves) {
    saves = new Map();
    savesByChat.set(key, saves);
  }

  const current = saves.get(activity.saveId);
  if (activity.status === 'saving') {
    saves.set(activity.saveId, {
      saveId: activity.saveId,
      status: 'saving',
      projectPath: activity.projectPath,
      updatedAt: Date.now(),
    });
  } else if (current) {
    if (activity.status === 'done') saves.delete(activity.saveId);
    else saves.set(activity.saveId, { ...current, status: 'error', updatedAt: Date.now() });
  } else {
    return;
  }

  if (saves.size === 0) savesByChat.delete(key);
  notify(key);
}

if (typeof window !== 'undefined') {
  window.addEventListener('mocu_memory_save', (event: Event) => {
    const activity = (event as CustomEvent<MemorySaveActivity>).detail;
    if (activity?.saveId && activity.status) applyActivity(activity);
  });
}

/** Remove old completed/error entries but never hide saves still in progress. */
export function clearMemorySaveStatus(chatId: string | null | undefined): void {
  const key = chatKey(chatId);
  const saves = savesByChat.get(key);
  if (!saves) return;
  for (const [saveId, item] of saves) {
    if (item.status !== 'saving') saves.delete(saveId);
  }
  if (saves.size === 0) savesByChat.delete(key);
  notify(key);
}

export function useMemorySaveStatus(chatId?: string | null): MemorySaveItem[] {
  const key = chatKey(chatId);
  const [saves, setSaves] = useState<MemorySaveItem[]>(() => getSnapshot(key));

  useEffect(() => {
    let listeners = listenersByChat.get(key);
    if (!listeners) {
      listeners = new Set();
      listenersByChat.set(key, listeners);
    }
    const listener = () => setSaves(getSnapshot(key));
    listeners.add(listener);
    listener();
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) listenersByChat.delete(key);
    };
  }, [key]);

  return saves;
}
