// src/chat/services/chatResourceToggles.ts
//
// Per-chat pinned resources, stored OUTSIDE React.
//
// The slash-command flow (/skill, /extension, /mcp, /agent) selects
// resources for a single request. This store adds the complementary
// flow: the user toggles resources ON for a conversation and they stay
// active for every message of that conversation until toggled OFF, so
// the slash command does not have to be repeated each time.
//
// Every chat conversation owns its own selection, keyed by chat id.
// Selections persist across app restarts (localStorage) and survive
// switching between conversations. A new (not yet created) chat uses
// the reserved NEW_CHAT_RESOURCE_KEY; once the first message creates
// the chat, ChatBox migrates the selection to the real chat id.
// The selected main-agent model is part of the same per-chat selection.

import { useSyncExternalStore } from 'react';

import type { SelectedSkill } from '../components/skillTypes';
import type { SelectedExtension } from '../components/extensionTypes';
import type { SelectedAgent } from '../components/agentTypes';
import type { SelectedMcpServer } from '../components/mcpTypes';

/** Key used for selections made before the chat exists. */
export const NEW_CHAT_RESOURCE_KEY = 'new-chat';

const STORAGE_KEY = 'mocu-chat-resource-toggles-v1';

/** Max stored conversations; oldest entries are pruned on save. */
const MAX_PERSISTED_CHATS = 50;

export type ChatResourceSelection = {
  skills: SelectedSkill[];
  extensions: SelectedExtension[];
  mcpServers: SelectedMcpServer[];
  agent: SelectedAgent | null;
  /*
   * Main-agent model override chosen in the composer model picker. It
   * belongs to THIS conversation only: null means the chat uses the
   * configured default model, and other chats never see this value.
   */
  model: string | null;
};

const EMPTY_SELECTION: ChatResourceSelection = {
  skills: [],
  extensions: [],
  mcpServers: [],
  agent: null,
  model: null,
};

const selections = new Map<string, ChatResourceSelection>();

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function isSelection(value: unknown): value is ChatResourceSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ChatResourceSelection>;

  return (
    Array.isArray(candidate.skills) &&
    Array.isArray(candidate.extensions) &&
    Array.isArray(candidate.mcpServers) &&
    (candidate.agent === null || typeof candidate.agent === 'object') &&
    /*
     * model is optional so selections persisted before the model picker
     * existed still validate; a missing model means the default model.
     */
    (candidate.model === undefined ||
      candidate.model === null ||
      typeof candidate.model === 'string')
  );
}

function loadPersistedSelections(): void {
  try {
    const storedValue = localStorage.getItem(STORAGE_KEY);

    if (!storedValue) {
      return;
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    if (!parsedValue || typeof parsedValue !== 'object') {
      return;
    }

    for (const [chatId, value] of Object.entries(
      parsedValue as Record<string, unknown>,
    )) {
      if (typeof chatId === 'string' && isSelection(value)) {
        selections.set(chatId, value);
      }
    }
  } catch (error) {
    console.error(
      '[Chat Resources] Failed to load pinned resources:',
      error,
    );
  }
}

function persistSelections(): void {
  try {
    let entries = [...selections.entries()];

    if (entries.length > MAX_PERSISTED_CHATS) {
      entries = entries.slice(entries.length - MAX_PERSISTED_CHATS);
    }

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch (error) {
    console.error(
      '[Chat Resources] Failed to save pinned resources:',
      error,
    );
  }
}

export function subscribeToChatResourceToggles(
  listener: () => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getChatResourceSelection(
  chatId: string | null,
): ChatResourceSelection {
  if (!chatId) {
    return EMPTY_SELECTION;
  }

  return selections.get(chatId) ?? EMPTY_SELECTION;
}

export function setChatResourceSelection(
  chatId: string,
  selection: ChatResourceSelection,
): void {
  const isEmpty =
    selection.skills.length === 0 &&
    selection.extensions.length === 0 &&
    selection.mcpServers.length === 0 &&
    selection.agent === null &&
    !selection.model;

  if (isEmpty) {
    selections.delete(chatId);
  } else {
    selections.set(chatId, {
      skills: [...selection.skills],
      extensions: [...selection.extensions],
      mcpServers: [...selection.mcpServers],
      agent: selection.agent,
      model: selection.model?.trim() || null,
    });
  }

  persistSelections();
  notifyListeners();
}

/** Removes every pinned resource of a conversation. */
export function clearChatResourceSelection(chatId: string): void {
  if (!selections.has(chatId)) {
    return;
  }

  selections.delete(chatId);
  persistSelections();
  notifyListeners();
}

/** Snapshot of the pinned selection of every known conversation. */
export function getAllChatResourceSelections(): Map<
  string,
  ChatResourceSelection
> {
  return new Map(selections);
}

/**
 * Moves the selection of a not-yet-created chat to its real chat id.
 * Called by ChatBox after the first message of a new chat created the
 * conversation, so the pinned resources keep applying to it.
 */
export function migrateNewChatResourceSelection(
  newChatId: string,
): void {
  const newChatSelection = selections.get(NEW_CHAT_RESOURCE_KEY);

  if (!newChatSelection) {
    return;
  }

  selections.delete(NEW_CHAT_RESOURCE_KEY);

  /*
   * Never overwrite a selection that already exists for the target
   * chat (e.g. resumed conversations with pinned resources).
   */
  if (!selections.has(newChatId)) {
    selections.set(newChatId, newChatSelection);
  }

  persistSelections();
  notifyListeners();
}

/** React hook: the pinned selection of one conversation. */
export function useChatResourceSelection(
  chatId: string | null,
): ChatResourceSelection {
  return useSyncExternalStore(
    subscribeToChatResourceToggles,
    () => getChatResourceSelection(chatId),
  );
}

// Hydrate once when the module is imported.
loadPersistedSelections();
