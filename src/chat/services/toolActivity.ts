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
//
// Every activity is scoped to the chat conversation whose agent produced
// it. Several chats can run agents at the same time, and each chat only
// ever sees its own tool boxes — an event without a chat id is resolved
// through the activity-id registry below (filled by the first dispatch of
// that tool call), so late/streaming updates reach the right chat even
// when the dispatcher itself has no config available.

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

  /*
   * Omitted on progress updates so the original input recorded by the
   * agents is preserved on the card.
   */
  args?: Record<string, unknown>;

  result?: string;

  status: AgentToolActivityStatus;

  /*
   * True when the tool streams live progress (extension commands that
   * declare `streaming: true` in their manifest). The chat shows the
   * live output panel for such cards while they run.
   */
  streaming?: boolean;

  /*
   * Accumulated live progress text streamed by the extension while the
   * command ran. Kept on the card after completion (next to the final
   * result) and persisted with the rest of the activity.
   */
  streamLog?: string;

  /*
   * The chat conversation this tool call belongs to. Set by the agents
   * from the runnable config (`mocuChatId` in `configurable`), so
   * parallel chat sessions never see each other's tool boxes.
   */
  chatId?: string;
};

/*
 * Config key the ChatBox sets so every agent can read the owning chat
 * id from its runnable config while it works.
 */
export const CHAT_ID_CONFIG_KEY = 'mocuChatId';

/*
 * activity id -> chat id, recorded from the first scoped dispatch of a
 * tool call. Used to scope follow-up events dispatched from places with
 * no access to the runnable config (extension host notifications).
 */
const activityIdToChatId = new Map<string, string>();

function recordActivityScope(
  activityId: string,
  chatId: string,
): void {
  if (activityIdToChatId.get(activityId) === chatId) {
    return;
  }

  activityIdToChatId.set(activityId, chatId);

  /*
   * Keep the registry bounded: tool call ids accumulate over a long
   * session, and old entries are never needed again once the request
   * finished.
   */
  if (activityIdToChatId.size > 500) {
    const oldestKey = activityIdToChatId.keys().next().value;

    if (oldestKey !== undefined) {
      activityIdToChatId.delete(oldestKey);
    }
  }
}

/*
 * Resolves the chat a tool call belongs to. Unscoped dispatchers (like
 * the extension host notification handler) call this so streaming
 * updates still land in the conversation that started the command.
 */
export function resolveActivityChatId(
  activityId: string | undefined,
): string | undefined {
  if (!activityId) {
    return undefined;
  }

  return activityIdToChatId.get(activityId);
}

export const dispatchAgentToolActivity = (
  activity: AgentToolActivity,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const chatId =
    activity.chatId ?? resolveActivityChatId(activity.id);

  if (chatId) {
    recordActivityScope(activity.id, chatId);
  }

  window.dispatchEvent(
    new CustomEvent<AgentToolActivity>(
      'mocu_tool_activity',
      {
        detail: chatId
          ? { ...activity, chatId }
          : activity,
      },
    ),
  );
};

/*
 * Reads the owning chat id from a runnable config. The ChatBox puts it
 * in `configurable` next to the LangGraph thread id, so every agent node
 * can scope its activity events to one conversation.
 */
export const getChatIdFromConfig = (
  config?: {
    configurable?: Record<string, unknown>;
  } | null,
): string | undefined => {
  const value = config?.configurable?.[CHAT_ID_CONFIG_KEY];

  return typeof value === 'string' && value.trim() !== ''
    ? value
    : undefined;
};
