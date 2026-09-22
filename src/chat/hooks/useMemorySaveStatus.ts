// src/chat/hooks/useMemorySaveStatus.ts
//
// Tracks the background project-memory save status for the chat UI,
// scoped per chat conversation.
//
// The project agent dispatches "mocu_memory_save" events carrying the
// id of the chat whose save is running. Each chat only ever shows the
// status of its own save — switching to another chat while a save is
// running no longer leaks the blinking/saving state into that chat.
//
// The store lives outside React, so a status survives unmounting the
// chat view (navigating to another page) and is picked back up when
// the view returns, even if the completion event fired while the chat
// was not mounted.

import { useEffect, useState } from 'react';

import type { MemorySaveActivity, MemorySaveStatus } from '../services/memoryActivity';

/*
 * Key used for events that carry no chat id (defensive fallback —
 * the project agent always sets one).
 */
const UNSCOPED_KEY = '__unscoped__';

/*
 * chat id -> last memory-save status of that chat. Kept outside React
 * so switching chats (which remounts the ChatBox) never loses the
 * status of a save that completed in the background.
 */
const statusByChatId = new Map<string, MemorySaveStatus>();

/*
 * Removes the stored status of a chat and tells every mounted hook
 * that shows it. Called when a new send starts in the chat, so the
 * mind icon of the previous turn does not linger below the next
 * response while it is being generated.
 */
export function clearMemorySaveStatus(chatId: string | null | undefined): void {
  if (!chatId) {
    return;
  }

  statusByChatId.delete(chatId);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<{ chatId: string }>(
        'mocu_memory_save_clear',
        {
          detail: { chatId },
        },
      ),
    );
  }
}

export function useMemorySaveStatus(
  chatId?: string | null,
): MemorySaveStatus | null {
  const storeKey = chatId ?? UNSCOPED_KEY;

  const [status, setStatus] = useState<MemorySaveStatus | null>(
    () => statusByChatId.get(storeKey) ?? null,
  );

  useEffect(() => {
    /*
     * Re-sync whenever this hook starts tracking a (different) chat:
     * the status may have changed while the view was elsewhere.
     */
    setStatus(statusByChatId.get(storeKey) ?? null);

    const applyActivity = (
      activity: MemorySaveActivity | undefined,
    ): void => {
      if (
        !activity ||
        (activity.status !== 'saving' &&
          activity.status !== 'done' &&
          activity.status !== 'error')
      ) {
        return;
      }

      const eventKey = activity.chatId ?? UNSCOPED_KEY;

      statusByChatId.set(eventKey, activity.status);

      if (eventKey === storeKey) {
        setStatus(activity.status);
      }
    };

    const handleMemorySave = (event: Event): void => {
      applyActivity(
        (event as CustomEvent<MemorySaveActivity>).detail,
      );
    };

    const handleMemorySaveClear = (event: Event): void => {
      const detail = (
        event as CustomEvent<{ chatId?: string }>
      ).detail;

      const eventKey = detail?.chatId ?? UNSCOPED_KEY;

      statusByChatId.delete(eventKey);

      if (eventKey === storeKey) {
        setStatus(null);
      }
    };

    window.addEventListener(
      'mocu_memory_save',
      handleMemorySave,
    );

    window.addEventListener(
      'mocu_memory_save_clear',
      handleMemorySaveClear,
    );

    return () => {
      window.removeEventListener(
        'mocu_memory_save',
        handleMemorySave,
      );

      window.removeEventListener(
        'mocu_memory_save_clear',
        handleMemorySaveClear,
      );
    };
  }, [storeKey]);

  return status;
}