// src/chat/hooks/useToolActivity.ts
//
// Chat-scoped, per-turn tool activity store.
//
// The chat/project agents dispatch "mocu_tool_activity" events while
// they work. Every event now carries the id of the chat conversation
// whose agent produced it, and this store keeps a SEPARATE bucket of
// activities for each chat. That way several conversations can run
// agents at the same time and each one only ever sees its own tool
// boxes — switching pages or switching chats never mixes them.
//
// The buckets live at module level, outside React, so navigating to
// Skills/Schedule/Docs/etc. (which unmounts ChatBox) does not lose the
// live tool boxes of a running request; the view simply resubscribes
// when the user comes back.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { AgentToolActivity } from '../services/toolActivity';
import { resolveActivityChatId } from '../services/toolActivity';

import {
  loadToolActivities,
  saveToolActivities,
} from '../storage/tool-activity-storage';

/*
 * Pending (not yet committed) activities of each chat's current request.
 */
const pendingByChat = new Map<string, AgentToolActivity[]>();

/*
 * Activities already attached to a specific assistant message. Seeded
 * from localStorage so the tool boxes are still visible after the app is
 * closed and reopened. Message ids are globally unique, so one shared
 * record is safe even with many chats.
 */
let committedActivities: Record<string, AgentToolActivity[]> =
  loadToolActivities();

/*
 * Listeners: one set per chat id plus a set for "committed" changes
 * (which can be observed from any chat view via getForMessage).
 */
const pendingListenersByChat = new Map<string, Set<() => void>>();

const committedListeners = new Set<() => void>();

function notifyPending(chatId: string): void {
  const chatListeners = pendingListenersByChat.get(chatId);

  if (!chatListeners) {
    return;
  }

  for (const listener of chatListeners) {
    listener();
  }
}

function notifyCommitted(): void {
  for (const listener of committedListeners) {
    listener();
  }
}

/*
 * Chat a tool activity belongs to. Events dispatched by the agents carry
 * the chat id directly; follow-up events from places without config
 * (extension host notifications) are resolved through the activity-id
 * registry in toolActivity.ts.
 */
function resolveChatId(activity: AgentToolActivity): string | null {
  const direct = activity.chatId;

  if (direct && direct.trim() !== '') {
    return direct;
  }

  return resolveActivityChatId(activity.id) ?? null;
}

function upsertActivity(
  activities: AgentToolActivity[],
  activity: AgentToolActivity,
): AgentToolActivity[] {
  const existingIndex = activities.findIndex(
    (entry) => entry.id === activity.id,
  );

  if (existingIndex === -1) {
    return [...activities, activity];
  }

  return activities.map((entry, index) =>
    index === existingIndex ? { ...entry, ...activity } : entry,
  );
}

function handleActivityEvent(event: Event): void {
  const activity = (event as CustomEvent<AgentToolActivity>).detail;

  if (!activity?.id) {
    return;
  }

  const chatId = resolveChatId(activity);

  if (!chatId) {
    return;
  }

  const next = upsertActivity(
    pendingByChat.get(chatId) ?? [],
    activity,
  );

  pendingByChat.set(chatId, next);

  notifyPending(chatId);
}

if (typeof window !== 'undefined') {
  window.addEventListener('mocu_tool_activity', handleActivityEvent);
}

/*
 * Called when a chat's new agent request starts, so that chat's tool
 * boxes start fresh. Other chats' boxes are untouched.
 */
export function beginToolActivityRequest(chatId: string): void {
  pendingByChat.set(chatId, []);

  notifyPending(chatId);
}

/*
 * Attaches a chat's current request tool activities to the assistant
 * message that answers it. Called right after the response message is
 * appended to that chat.
 */
export function commitToolActivities(
  chatId: string,
  messageId: string,
): void {
  const activities = pendingByChat.get(chatId) ?? [];

  if (activities.length === 0) {
    return;
  }

  pendingByChat.set(chatId, []);

  notifyPending(chatId);

  committedActivities = {
    ...committedActivities,
    [messageId]: activities,
  };

  /*
   * Persist immediately so the boxes survive an app restart.
   */
  saveToolActivities(committedActivities);

  notifyCommitted();
}

const EMPTY_ACTIVITIES: AgentToolActivity[] = [];

export function getPendingToolActivities(
  chatId: string | null,
): AgentToolActivity[] {
  if (!chatId) {
    return EMPTY_ACTIVITIES;
  }

  return pendingByChat.get(chatId) ?? EMPTY_ACTIVITIES;
}

export function getCommittedToolActivitiesForMessage(
  messageId: string,
): AgentToolActivity[] {
  return committedActivities[messageId] ?? EMPTY_ACTIVITIES;
}

function subscribeToPending(chatId: string | null) {
  return (listener: () => void): (() => void) => {
    if (!chatId) {
      return () => undefined;
    }

    let chatListeners = pendingListenersByChat.get(chatId);

    if (!chatListeners) {
      chatListeners = new Set();

      pendingListenersByChat.set(chatId, chatListeners);
    }

    chatListeners.add(listener);

    return () => {
      chatListeners?.delete(listener);
    };
  };
}

function subscribeToCommitted(
  listener: () => void,
): () => void {
  committedListeners.add(listener);

  return () => {
    committedListeners.delete(listener);
  };
}

/*
 * React binding for one chat view. Returns that chat's pending
 * activities plus a stable reader for committed activities; re-renders
 * happen when either changes for this chat.
 */
export function useToolActivity(chatId: string | null) {
  /*
   * A first message can create its chat inside handleSendMessage, while
   * this hook was initialized with a null chat id. Track the request id
   * explicitly so its live activities are still observed immediately.
   */
  const [activityChatId, setActivityChatId] = useState(chatId);

  useEffect(() => {
    setActivityChatId(chatId);
  }, [chatId]);

  /*
   * Memoized so React only re-subscribes when the displayed/request chat
   * changes, not on every render.
   */
  const subscribePending = useMemo(
    () => subscribeToPending(activityChatId),
    [activityChatId],
  );

  const pendingActivities = useSyncExternalStore(
    subscribePending,
    () => getPendingToolActivities(activityChatId),
  );

  /*
   * Subscribing to committed changes makes getForMessage results fresh
   * as soon as a response is committed, even before the messages state
   * itself re-renders the list.
   */
  useSyncExternalStore(
    subscribeToCommitted,
    () => committedActivities,
  );

  const getForMessage = useCallback(
    (messageId: string): AgentToolActivity[] =>
      getCommittedToolActivitiesForMessage(messageId),
    [],
  );

  return {
    pendingActivities,
    beginRequest: useCallback((requestChatId: string) => {
      setActivityChatId(requestChatId);
      beginToolActivityRequest(requestChatId);
    }, []),
    commit: useCallback((requestChatId: string, messageId: string) => {
      commitToolActivities(requestChatId, messageId);
    }, []),
    getForMessage,
  };
}
