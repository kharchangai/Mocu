// src/chat/services/toolActivity.ts
//
// Rich tool-activity channel for the chat UI.
//
// The avatar keeps using the simple "mocu_activity" event (tool name
// only). The chat activity feed needs more, so the chat agent and the
// project agent additionally dispatch "mocu_tool_activity" events that
// carry the tool arguments and the tool result, letting the chat show a
// collapsible box per tool call ("Running a terminal command…" with the
// executed command and its output behind an arrow).

export type AgentToolActivityStatus =
  | 'running'
  | 'done'
  | 'error';

export type AgentToolActivity = {
  /*
   * Unique per tool call (the LangChain tool_call_id), so follow-up
   * events update the same card instead of adding a new one.
   */
  id: string;

  tool: string;

  args: Record<string, unknown>;

  result?: string;

  status: AgentToolActivityStatus;
};

export const dispatchAgentToolActivity = (
  activity: AgentToolActivity,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<AgentToolActivity>(
      'mocu_tool_activity',
      {
        detail: activity,
      },
    ),
  );
};
