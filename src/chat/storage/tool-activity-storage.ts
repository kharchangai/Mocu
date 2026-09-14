// src/chat/storage/tool-activity-storage.ts
//
// Persistence for chat tool-activity boxes.
//
// Maps assistant message ids to the tool activities that were used to
// produce them, so the collapsible tool boxes survive an app restart
// (the chat history itself is stored with the same message ids in
// "mocu-chat-history-v1").
//
// Kept intentionally small: only the most recent messages keep their
// boxes, and very long tool results are truncated so localStorage
// cannot grow unbounded.

import type { AgentToolActivity } from '../services/toolActivity';

const TOOL_ACTIVITY_STORAGE_KEY = 'mocu-tool-activity-v1';

/*
 * How many messages keep their tool boxes across restarts.
 */
const MAX_STORED_MESSAGES = 40;

/*
 * Safety caps for a single activity entry.
 */
const MAX_RESULT_LENGTH = 6000;
const MAX_INPUT_JSON_LENGTH = 2000;

function clampText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}…`
    : value;
}

function isAgentToolActivity(value: unknown): value is AgentToolActivity {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const activity = value as Partial<AgentToolActivity>;

  return (
    typeof activity.id === 'string' &&
    typeof activity.tool === 'string' &&
    (activity.status === 'running' ||
      activity.status === 'done' ||
      activity.status === 'error') &&
    typeof activity.args === 'object' &&
    activity.args !== null
  );
}

export function loadToolActivities(): Record<
  string,
  AgentToolActivity[]
> {
  try {
    const storedValue = localStorage.getItem(
      TOOL_ACTIVITY_STORAGE_KEY,
    );

    if (!storedValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(storedValue);

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      return {};
    }

    const activitiesByMessage: Record<
      string,
      AgentToolActivity[]
    > = {};

    for (const [
      messageId,
      messageActivities,
    ] of Object.entries(
      parsedValue as Record<string, unknown>,
    )) {
      if (
        !Array.isArray(messageActivities)
      ) {
        continue;
      }

      const validActivities =
        messageActivities.filter(
          isAgentToolActivity,
        );

      if (validActivities.length > 0) {
        activitiesByMessage[messageId] =
          validActivities;
      }
    }

    return activitiesByMessage;
  } catch (error) {
    console.error(
      '[Tool Activity Storage] Failed to load tool activities:',
      error,
    );

    return {};
  }
}

export function saveToolActivities(
  activitiesByMessage: Record<
    string,
    AgentToolActivity[]
  >,
): void {
  try {
    const entries = Object.entries(
      activitiesByMessage,
    );

    /*
     * Keep only the most recent messages' boxes.
     */
    const trimmedEntries = entries.slice(
      Math.max(0, entries.length - MAX_STORED_MESSAGES),
    );

    const trimmed: Record<
      string,
      AgentToolActivity[]
    > = {};

    for (const [
      messageId,
      messageActivities,
    ] of trimmedEntries) {
      trimmed[messageId] =
        messageActivities.map(
          (activity) => ({
            ...activity,

            result: activity.result
              ? clampText(
                  activity.result,
                  MAX_RESULT_LENGTH,
                )
              : activity.result,

            args: Object.fromEntries(
              Object.entries(
                activity.args,
              ).map(([key, value]) => [
                key,
                typeof value === 'string'
                  ? clampText(
                      value,
                      MAX_INPUT_JSON_LENGTH,
                    )
                  : value,
              ]),
            ),
          }),
        );
    }

    localStorage.setItem(
      TOOL_ACTIVITY_STORAGE_KEY,
      JSON.stringify(trimmed),
    );
  } catch (error) {
    console.error(
      '[Tool Activity Storage] Failed to save tool activities:',
      error,
    );
  }
}

export function clearStoredToolActivities(): void {
  try {
    localStorage.removeItem(
      TOOL_ACTIVITY_STORAGE_KEY,
    );
  } catch (error) {
    console.error(
      '[Tool Activity Storage] Failed to clear tool activities:',
      error,
    );
  }
}
