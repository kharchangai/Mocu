// src/chat/hooks/useToolActivity.ts
//
// Per-turn tool activity store for the chat.
//
// The chat/project agents dispatch "mocu_tool_activity" events while
// they work. This hook accumulates the events of the current request
// ("pending"), and once the agent's response message is appended the
// pending activities are committed to that message id. That way each
// assistant message keeps the tool boxes that were used to produce it
// (shown below the user's message, above the response), and they stay
// visible after the answer arrives instead of disappearing.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentToolActivity } from '../services/toolActivity';

import {
  loadToolActivities,
  saveToolActivities,
} from '../storage/tool-activity-storage';

export function useToolActivity() {
  /*
   * Tool activities of the request that is currently running.
   */
  const [pendingActivities, setPendingActivities] = useState<
    AgentToolActivity[]
  >([]);

  /*
   * Tool activities already attached to a specific assistant message.
   * Seeded from localStorage so the tool boxes are still visible after
   * the app is closed and reopened.
   */
  const [
    committedActivities,
    setCommittedActivities,
  ] = useState<Record<string, AgentToolActivity[]>>(
    () => loadToolActivities(),
  );

  /*
   * Mirror of the pending list so event handlers and commit always see
   * the latest activities without stale closures.
   */
  const pendingRef = useRef<AgentToolActivity[]>([]);

  useEffect(() => {
    const handleActivity = (event: Event) => {
      const activity = (
        event as CustomEvent<AgentToolActivity>
      ).detail;

      if (!activity?.id) {
        return;
      }

      const existing =
        pendingRef.current;

      const existingIndex =
        existing.findIndex(
          (entry) => entry.id === activity.id,
        );

      const next =
        existingIndex === -1
          ? [...existing, activity]
          : existing.map((entry, index) =>
              index === existingIndex
                ? { ...entry, ...activity }
                : entry,
            );

      pendingRef.current = next;

      setPendingActivities(next);
    };

    window.addEventListener(
      'mocu_tool_activity',
      handleActivity,
    );

    return () => {
      window.removeEventListener(
        'mocu_tool_activity',
        handleActivity,
      );
    };
  }, []);

  /*
   * Called when a new agent request starts, so its boxes start fresh.
   */
  const beginRequest = useCallback(() => {
    pendingRef.current = [];

    setPendingActivities([]);
  }, []);

  /*
   * Attaches the current request's tool activities to the assistant
   * message that answers it. Called right after the response message
   * is appended to the chat.
   */
  const commit = useCallback(
    (messageId: string) => {
      const activities =
        pendingRef.current;

      if (
        activities.length === 0
      ) {
        return;
      }

      pendingRef.current = [];

      setPendingActivities([]);

      setCommittedActivities(
        (previous) => {
          const next = {
            ...previous,
            [messageId]: activities,
          };

          /*
           * Persist immediately so the boxes survive an app restart.
           */
          saveToolActivities(next);

          return next;
        },
      );
    },
    [],
  );

  /*
   * Returns the tool activities recorded for one assistant message.
   */
  const getForMessage = useCallback(
    (
      messageId: string,
    ): AgentToolActivity[] =>
      committedActivities[
        messageId
      ] ?? [],
    [committedActivities],
  );

  return {
    pendingActivities,
    beginRequest,
    commit,
    getForMessage,
  };
}
