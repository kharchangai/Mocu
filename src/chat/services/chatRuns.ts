// src/chat/services/chatRuns.ts
//
// Per-chat agent run state, stored OUTSIDE React.
//
// The old design kept the running request inside ChatBox refs
// (abort controller + isLoading). Because ChatBox unmounts when the user
// navigates to Skills/Schedule/Docs/etc., the unmount cleanup aborted the
// request — a page switch killed the agent mid-job. It also meant only a
// single chat could run at a time.
//
// Now every chat conversation owns its own run record here:
//   - its own AbortController (the stop button only stops that chat),
//   - its own isLoading flag (each chat view shows its own spinner),
//   - N chats can run at the same time, fully isolated from each other.
//
// ChatBox subscribes to the store for the chat it displays; navigating
// away or switching chats never touches another chat's run.

import { useSyncExternalStore } from 'react';

export type ChatRunState = {
  chatId: string;
  isLoading: boolean;
  controller: AbortController | null;
};

const runs = new Map<string, ChatRunState>();

const listeners = new Set<() => void>();

function notifyListeners(): void {
  rebuildRunningChatIdsSnapshot();

  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToChatRuns(
  listener: () => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function isChatRunActive(chatId: string | null): boolean {
  if (!chatId) {
    return false;
  }

  return runs.get(chatId)?.isLoading ?? false;
}

function getChatRun(chatId: string): ChatRunState | undefined {
  return runs.get(chatId);
}

/*
 * Snapshot helpers for useSyncExternalStore. The snapshot must be a
 * stable primitive, so expose the boolean flag itself.
 */
function subscribeToChatRunFlag(listener: () => void): () => void {
  return subscribeToChatRuns(listener);
}

export function useIsChatRunActive(
  chatId: string | null | undefined,
): boolean {
  return useSyncExternalStore(
    subscribeToChatRunFlag,
    () => isChatRunActive(chatId ?? null),
  );
}

/*
 * Starts a run for one chat and returns its controller. Calling this for
 * a chat that is already running is a no-op guard: the previous run is
 * never aborted implicitly.
 */
export function beginChatRun(chatId: string): AbortController {
  const existing = getChatRun(chatId);

  if (existing?.isLoading && existing.controller) {
    return existing.controller;
  }

  const controller = new AbortController();

  runs.set(chatId, {
    chatId,
    isLoading: true,
    controller,
  });

  notifyListeners();

  return controller;
}

/*
 * Finishes the run of one chat. Only ends the run when the controller is
 * still the one that started it (a newer run may have replaced it).
 */
export function endChatRun(
  chatId: string,
  controller: AbortController,
): void {
  const run = getChatRun(chatId);

  if (!run || run.controller !== controller) {
    return;
  }

  runs.delete(chatId);

  notifyListeners();
}

/*
 * Aborts the run of ONE chat. Every other chat keeps running.
 */
export function abortChatRun(chatId: string | null): void {
  if (!chatId) {
    return;
  }

  const run = getChatRun(chatId);

  run?.controller?.abort();
}

export function hasAnyChatRun(): boolean {
  for (const run of runs.values()) {
    if (run.isLoading) {
      return true;
    }
  }

  return false;
}

/*
 * Ids of every chat with a running agent request. Used by the sidebar to
 * show a live indicator on chats that are working in the background.
 *
 * The array is a cached snapshot (rebuilt only when the set of running
 * chats actually changes) so it is safe as a useSyncExternalStore
 * snapshot.
 */
let runningChatIdsSnapshot: string[] = [];

function rebuildRunningChatIdsSnapshot(): void {
  const ids: string[] = [];

  for (const run of runs.values()) {
    if (run.isLoading) {
      ids.push(run.chatId);
    }
  }

  runningChatIdsSnapshot = ids;
}

export function getRunningChatIds(): string[] {
  return runningChatIdsSnapshot;
}

export function useRunningChatIds(): string[] {
  return useSyncExternalStore(
    subscribeToChatRuns,
    getRunningChatIds,
  );
}
