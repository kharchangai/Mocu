import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
} from '@langchain/core/messages';

import { ChatInput } from './ChatInput';
import { resolveFileMentions, type SelectedFileReference } from './fileMentionReferences';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ChatStatusBubble } from './ChatStatusBubble';
import { ToolActivityFeed } from './ToolActivityFeed';
import { MemorySaveIndicator } from './MemorySaveIndicator';
import {
  respondToExtensionInteraction,
  useExtensionInteraction,
} from '../../extensions/services/extension-interaction-store';

import { callChatAgent } from '../../services/ai/chat-agent';
import {
  callProjectAgent,
  PROJECT_AGENT_PARTIAL_PROGRESS_MARKER,
  ProjectAgentModelError,
} from '../../services/ai/project-agent';
import { isAbortError } from '../../services/aiService';

import {
  beginGuardedRun,
  endGuardedRun,
} from '../../services/devReloadGuard';

import {
  setActiveRequestChat,
} from '../services/activeChatSession';

import {
  beginChatRun,
  endChatRun,
  abortChatRun,
  hasAnyChatRun,
  useIsChatRunActive,
} from '../services/chatRuns';

import {
  CHAT_ID_CONFIG_KEY,
  type AgentToolActivity,
} from '../services/toolActivity';
import {
  getStepWorkflowLogs,
  getStepWorkflowOverview,
  resumeStepByStepWorkflow,
  type StepWorkflowLogPage,
  type StepWorkflowOverview,
} from '../../services/ai/stepbystep/workflowManager';
import {
  getFocusChatTurns,
  getFocusOverview,
  hasActiveFocusSession,
  parseFocusStartGoal,
  resumeFocusSession,
  type FocusChatTurn,
  type FocusOverview,
} from '../../services/ai/focus/focusManager';

import { useToolActivity } from '../hooks/useToolActivity';
import {
  clearMemorySaveStatus,
  useMemorySaveStatus,
} from '../hooks/useMemorySaveStatus';
import { useMentionResources } from './useMentionResources';
import type { MentionResourceNames } from './SlashMentionText';
import { migrateNewChatResourceSelection } from '../services/chatResourceToggles';

import {
  loadShortTermMemory,
  saveShortTermMemory,
} from '../services/shortTermMemory';

import type { ChatMessage } from '../types/chat';

import type { SelectedSkill } from './skillTypes';
import type { SelectedExtension } from './extensionTypes';
import type { SelectedAgent } from './agentTypes';
import type { SelectedMcpServer } from './mcpTypes';
import type { GatewayReasoningEffort } from '../../services/ai/model-catalog';

import './ChatBox.css';

/*
 * Per-message wrapper around UserMessage. The memoized UserMessage
 * needs stable props; creating the edit callback inline (per render)
 * would break memoization, so the callback is built here with
 * useCallback and the message row only re-renders when its own content
 * changes.
 */
const EditableUserMessage = memo(function EditableUserMessage({
  message,
  resourceNames,
  onEdit,
}: {
  message: ChatMessage;
  resourceNames: MentionResourceNames;
  onEdit: (message: ChatMessage) => void;
}) {
  const handleEdit = useCallback(
    () => onEdit(message),
    [onEdit, message],
  );

  return (
    <UserMessage
      content={message.content}
      resourceNames={resourceNames}
      onEdit={handleEdit}
    />
  );
});

type EnsureChatResult = {
  chatId: string;
  wasCreated: boolean;
};

/*
 * The folder payload ChatInput attaches to a send. ChatBox uses it to
 * create the first chat with the folder selected by the user.
 */
type SendOptions = {
  projectPath?: string | null;
  selectedSkills?: SelectedSkill[];
  selectedExtensions?: SelectedExtension[];
  selectedMcpServers?: SelectedMcpServer[];
  selectedAgent?: SelectedAgent | null;
  /*
   * Model override chosen in the composer model picker. It reaches only
   * the main agents through the agent config; null/undefined keeps the
   * configured default model.
   */
  selectedModel?: string | null;
  selectedReasoningEffort?: GatewayReasoningEffort | null;
  fileReferences?: SelectedFileReference[];
};

type ProjectAgentFailureDetails = {
  summary: string;
  progress: string;
};

type WorkflowLogEntry = StepWorkflowLogPage['entries'][number];

type WorkflowLogTurn = {
  workflowId: string;
  stepNumber: number;
  message: string;
  time: string;
  entries: WorkflowLogEntry[];
};

type ChatThreadMarker = {
  type: 'step' | 'focus';
  sectionNumber: number;
  position: 'start' | 'middle' | 'end' | 'single';
  label: boolean;
  canResume: boolean;
};

type ThreadMessageGroup = {
  type: 'step' | 'focus';
  id: string;
  sectionNumber: number;
  userMessageIds: string[];
  firstIndex: number;
  lastIndex: number;
};

type WorkflowMessageMapping = {
  activitiesByMessage: Map<string, AgentToolActivity[]>;
  threadMarkers: Map<string, ChatThreadMarker>;
};

function workflowLogData(entry: WorkflowLogEntry): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(entry.preview);

    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    // Large tool output can truncate the JSON preview. Recover the leading
    // scalar fields (especially callId/name) so completed calls still update.
    const partial: Record<string, unknown> = {};

    for (const key of ['callId', 'name', 'message', 'reply', 'result', 'action']) {
      const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(entry.preview);

      if (!match) {
        continue;
      }

      try {
        partial[key] = JSON.parse(`"${match[1]}"`);
      } catch {
        partial[key] = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    }

    return partial;
  }
}

function buildWorkflowMessageMapping(
  entries: WorkflowLogEntry[],
  messages: ChatMessage[],
  resumableWorkflowId: string | null,
): WorkflowMessageMapping {
  const turns: WorkflowLogTurn[] = [];
  let currentTurn: WorkflowLogTurn | null = null;

  for (const entry of entries) {
    if (entry.kind === 'user') {
      if (currentTurn) {
        turns.push(currentTurn);
      }

      const message = workflowLogData(entry).message;
      currentTurn = typeof message === 'string'
        ? { workflowId: entry.workflowId, stepNumber: entry.stepNumber, message, time: entry.time, entries: [] }
        : null;
    } else if (currentTurn) {
      currentTurn.entries.push(entry);
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  const userMessageIndexes = messages
    .map((message, index) => message.role === 'user' ? index : -1)
    .filter((index) => index >= 0);
  const userMessages = userMessageIndexes.map((index) => messages[index]);
  const activitiesByMessage = new Map<string, AgentToolActivity[]>();
  const groups = new Map<string, ThreadMessageGroup>();
  const lastMessageByWorkflowId = new Map<string, string>();
  let messageSearchStart = 0;

  for (const turn of turns) {
    const matchingIndexes = userMessages
      .map((message, index) => ({ message, index }))
      .filter(({ message, index }) =>
        index >= messageSearchStart &&
        message.content.trim() === turn.message.trim(),
      )
      .map(({ index }) => index);

    const turnTime = Date.parse(turn.time);
    const fallbackIndexes = userMessages
      .map((_message, index) => index)
      .filter((index) =>
        index >= messageSearchStart &&
        Number.isFinite(Date.parse(userMessages[index].createdAt)),
      );
    const candidateIndexes = matchingIndexes.length > 0
      ? matchingIndexes
      : Number.isFinite(turnTime)
        ? fallbackIndexes
        : [];

    if (candidateIndexes.length === 0) {
      continue;
    }

    const messageIndex = Number.isFinite(turnTime)
      ? candidateIndexes.reduce((closest, candidate) => {
          const closestTime = Math.abs(
            Date.parse(userMessages[closest].createdAt) - turnTime,
          );
          const candidateTime = Math.abs(
            Date.parse(userMessages[candidate].createdAt) - turnTime,
          );
          return candidateTime < closestTime ? candidate : closest;
        }, candidateIndexes[0])
      : candidateIndexes[0];

    if (
      matchingIndexes.length === 0 &&
      Number.isFinite(turnTime) &&
      Math.abs(Date.parse(userMessages[messageIndex].createdAt) - turnTime) > 5 * 60 * 1000
    ) {
      continue;
    }

    const matchedMessage = userMessages[messageIndex];
    const fullMessageIndex = userMessageIndexes[messageIndex];
    const groupKey = `${turn.workflowId}:${turn.stepNumber}`;
    const group = groups.get(groupKey) ?? {
      type: 'step',
      id: turn.workflowId,
      sectionNumber: turn.stepNumber,
      userMessageIds: [],
      firstIndex: fullMessageIndex,
      lastIndex: fullMessageIndex,
    };
    group.userMessageIds.push(matchedMessage.id);
    lastMessageByWorkflowId.set(turn.workflowId, matchedMessage.id);
    group.firstIndex = Math.min(group.firstIndex, fullMessageIndex);
    group.lastIndex = Math.max(group.lastIndex, fullMessageIndex);
    groups.set(groupKey, group);

    const activities: AgentToolActivity[] = [];
    const activityByCallId = new Map<string, number>();

    for (const entry of turn.entries) {
      const data = workflowLogData(entry);

      if (entry.kind === 'tool_call') {
        const callId = typeof data.callId === 'string' ? data.callId : entry.id;
        const args = data.arguments;
        const activity: AgentToolActivity = {
          id: callId,
          tool: typeof data.name === 'string' ? data.name : 'workflow_tool',
          args: args && typeof args === 'object' && !Array.isArray(args)
            ? args as Record<string, unknown>
            : {},
          status: 'running',
        };

        activityByCallId.set(callId, activities.length);
        activities.push(activity);
      } else if (entry.kind === 'tool_result') {
        const callId = typeof data.callId === 'string' ? data.callId : '';
        const activityIndex = activityByCallId.get(callId);

        if (activityIndex === undefined) {
          continue;
        }

        const result = typeof data.result === 'string'
          ? data.result
          : JSON.stringify(data.result ?? '');
        let status: AgentToolActivity['status'] = 'done';

        try {
          const parsed: unknown = JSON.parse(result);
          if (
            parsed && typeof parsed === 'object' &&
            ('ok' in parsed && parsed.ok === false || 'error' in parsed)
          ) {
            status = 'error';
          }
        } catch {
          // Most successful tool results are plain text, not JSON.
        }

        activities[activityIndex] = {
          ...activities[activityIndex],
          result,
          status,
        };
      }
    }

    if (activities.length > 0) {
      activitiesByMessage.set(matchedMessage.id, activities);
    }

    messageSearchStart = messageIndex + 1;
  }

  const threadMarkers = new Map<string, ChatThreadMarker>();
  for (const group of groups.values()) {
    const firstUserId = group.userMessageIds[0];
    const finalIndex = messages[group.lastIndex + 1]?.role === 'assistant'
      ? group.lastIndex + 1
      : group.lastIndex;
    for (let index = group.firstIndex; index <= finalIndex; index += 1) {
      const message = messages[index];
      if (!message) continue;
      const isFirst = index === group.firstIndex;
      const isLast = index === finalIndex;
      const position = isFirst && isLast ? 'single' : isFirst ? 'start' : isLast ? 'end' : 'middle';
      threadMarkers.set(message.id, {
        type: group.type,
        sectionNumber: group.sectionNumber,
        position,
        label: message.id === firstUserId,
        canResume: false,
      });
    }
  }

  const resumableMessageId = resumableWorkflowId ? lastMessageByWorkflowId.get(resumableWorkflowId) : undefined;
  const resumableMarker = resumableMessageId ? threadMarkers.get(resumableMessageId) : undefined;
  if (resumableMessageId && resumableMarker) {
    threadMarkers.set(resumableMessageId, { ...resumableMarker, canResume: true });
  }

  return {
    activitiesByMessage,
    threadMarkers,
  };
}

function buildFocusMessageMapping(
  turns: FocusChatTurn[],
  messages: ChatMessage[],
  resumableFocusId: string | null,
): Map<string, ChatThreadMarker> {
  const userMessageIndexes = messages
    .map((message, index) => message.role === 'user' ? index : -1)
    .filter((index) => index >= 0);
  const userMessages = userMessageIndexes.map((index) => messages[index]);
  const groups = new Map<string, ThreadMessageGroup>();
  const lastMessageByFocusId = new Map<string, string>();
  let messageSearchStart = 0;

  for (const turn of turns) {
    const matchingIndexes = userMessages
      .map((message, index) => ({ message, index }))
      .filter(({ message, index }) =>
        index >= messageSearchStart && message.content.trim() === turn.message.trim(),
      )
      .map(({ index }) => index);
    const turnTime = Date.parse(turn.time);
    const fallbackIndexes = userMessages
      .map((_message, index) => index)
      .filter((index) => index >= messageSearchStart && Number.isFinite(Date.parse(userMessages[index].createdAt)));
    const candidates = matchingIndexes.length > 0
      ? matchingIndexes
      : Number.isFinite(turnTime) ? fallbackIndexes : [];
    if (candidates.length === 0) continue;

    const messageIndex = Number.isFinite(turnTime)
      ? candidates.reduce((closest, candidate) => {
          const closestDistance = Math.abs(Date.parse(userMessages[closest].createdAt) - turnTime);
          const candidateDistance = Math.abs(Date.parse(userMessages[candidate].createdAt) - turnTime);
          return candidateDistance < closestDistance ? candidate : closest;
        }, candidates[0])
      : candidates[0];
    if (
      matchingIndexes.length === 0 && Number.isFinite(turnTime) &&
      Math.abs(Date.parse(userMessages[messageIndex].createdAt) - turnTime) > 5 * 60 * 1000
    ) continue;

    const message = userMessages[messageIndex];
    const messageId = message.id;
    const fullMessageIndex = userMessageIndexes[messageIndex];
    const groupKey = `${turn.focusId}:${turn.sectionNumber}`;
    const group = groups.get(groupKey) ?? {
      type: 'focus',
      id: turn.focusId,
      sectionNumber: turn.sectionNumber,
      userMessageIds: [],
      firstIndex: fullMessageIndex,
      lastIndex: fullMessageIndex,
    };
    group.userMessageIds.push(messageId);
    lastMessageByFocusId.set(turn.focusId, messageId);
    group.firstIndex = Math.min(group.firstIndex, fullMessageIndex);
    group.lastIndex = Math.max(group.lastIndex, fullMessageIndex);
    groups.set(groupKey, group);
    messageSearchStart = messageIndex + 1;
  }

  const threadMarkers = new Map<string, ChatThreadMarker>();
  for (const group of groups.values()) {
    const firstUserId = group.userMessageIds[0];
    const finalIndex = messages[group.lastIndex + 1]?.role === 'assistant'
      ? group.lastIndex + 1
      : group.lastIndex;
    for (let index = group.firstIndex; index <= finalIndex; index += 1) {
      const message = messages[index];
      if (!message) continue;
      const isFirst = index === group.firstIndex;
      const isLast = index === finalIndex;
      const position = isFirst && isLast ? 'single' : isFirst ? 'start' : isLast ? 'end' : 'middle';
      threadMarkers.set(message.id, {
        type: group.type,
        sectionNumber: group.sectionNumber,
        position,
        label: message.id === firstUserId,
        canResume: false,
      });
    }
  }

  const resumableMessageId = resumableFocusId ? lastMessageByFocusId.get(resumableFocusId) : undefined;
  const resumableMarker = resumableMessageId ? threadMarkers.get(resumableMessageId) : undefined;
  if (resumableMessageId && resumableMarker) {
    threadMarkers.set(resumableMessageId, { ...resumableMarker, canResume: true });
  }

  return threadMarkers;
}

function getProjectAgentFailureDetails(
  content: string,
): ProjectAgentFailureDetails | undefined {
  const markerIndex = content.indexOf(
    PROJECT_AGENT_PARTIAL_PROGRESS_MARKER,
  );

  if (markerIndex < 0) {
    return undefined;
  }

  return {
    summary: content.slice(0, markerIndex).trim(),
    progress: content
      .slice(markerIndex + PROJECT_AGENT_PARTIAL_PROGRESS_MARKER.length)
      .trim(),
  };
}

type ChatBoxProps = {
  chatId: string | null;
  messages: ChatMessage[];
  agentName?: string;
  projectPath?: string;
  projectDescription?: string;

  onEnsureChat: (
    firstMessage: string,
    projectPath: string,
    initialHistory?: ChatMessage[],
  ) => Promise<EnsureChatResult>;

  onAppendMessage: (
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
  ) => ChatMessage;

};

function convertToLangChainMessages(
  messages: ChatMessage[],
): BaseMessage[] {
  return messages.map((message) =>
    message.role === 'user'
      ? new HumanMessage(message.content)
      : new AIMessage(message.content),
  );
}

export function ChatBox({
  chatId,
  messages,
  agentName = 'Mocu',
  projectPath = '',
  projectDescription = '',
  onEnsureChat,
  onAppendMessage,
}: ChatBoxProps) {
  /*
   * True only while a send is creating/resuming its conversation (before
   * a chat id exists that the run store can track). Once the run starts,
   * the busy flag comes from the per-chat run store instead.
   */
  const [isPreparingChat, setIsPreparingChat] = useState(false);

  const [draftMessage, setDraftMessage] = useState('');
  const [resumableWorkflow, setResumableWorkflow] = useState<StepWorkflowOverview | null>(null);
  const [resumableFocus, setResumableFocus] = useState<FocusOverview | null>(null);
  const [focusChatTurns, setFocusChatTurns] = useState<FocusChatTurn[]>([]);
  const [resumingType, setResumingType] = useState<'step' | 'focus' | null>(null);
  const [savedWorkRefreshKey, setSavedWorkRefreshKey] = useState(0);

  /*
   * Busy state of THIS chat. The run store lives outside React, so a
   * running request keeps going when the user navigates to another page
   * or switches chats, and this flag picks the state back up when the
   * view returns.
   */
  const isChatBusy = useIsChatRunActive(chatId);

  const isLoading = isChatBusy || isPreparingChat;
  const extensionInteraction = useExtensionInteraction(chatId);

  useEffect(() => {
    const handleSavedWorkChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ chatId?: string }>).detail;
      if (detail?.chatId === chatId) {
        setSavedWorkRefreshKey((current) => current + 1);
      }
    };
    window.addEventListener('mocu_saved_work_changed', handleSavedWorkChanged);
    return () => window.removeEventListener('mocu_saved_work_changed', handleSavedWorkChanged);
  }, [chatId]);

  useEffect(() => {
    if (!chatId) {
      setResumableWorkflow(null);
      setResumableFocus(null);
      setFocusChatTurns([]);
      return;
    }

    let cancelled = false;
    void Promise.all([
      getStepWorkflowOverview(chatId),
      getFocusOverview(chatId),
      getFocusChatTurns(chatId),
    ]).then(([workflow, focus, focusTurns]) => {
      if (cancelled) return;
      setResumableWorkflow(workflow && workflow.status !== 'active' ? workflow : null);
      setResumableFocus(focus && focus.status !== 'active' ? focus : null);
      setFocusChatTurns(focusTurns);
    }).catch(() => {
      if (!cancelled) {
        setResumableWorkflow(null);
        setResumableFocus(null);
        setFocusChatTurns([]);
      }
    });

    return () => { cancelled = true; };
  }, [chatId, messages.length, savedWorkRefreshKey]);

  const handleResumeWorkflow = async (): Promise<void> => {
    if (!chatId || !resumableWorkflow || resumingType) return;
    setResumingType('step');
    try {
      await resumeStepByStepWorkflow(chatId, resumableWorkflow.id);
      setResumableWorkflow(null);
      onAppendMessage(chatId, 'assistant', 'Step-by-Step is ready to continue from your saved progress. Send a message to pick up where you left off.');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not resume this workflow.');
    } finally {
      setResumingType(null);
    }
  };

  const handleResumeFocus = async (): Promise<void> => {
    if (!chatId || !resumableFocus || resumingType) return;
    setResumingType('focus');
    try {
      await resumeFocusSession(chatId, resumableFocus.id);
      setResumableFocus(null);
      onAppendMessage(chatId, 'assistant', 'Focus is ready to continue from your saved progress. Send a message to pick up where you left off.');
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not resume this Focus session.');
    } finally {
      setResumingType(null);
    }
  };

  const handleExtensionAction = async (actionId: string): Promise<void> => {
    if (!chatId) {
      return;
    }
    await respondToExtensionInteraction(chatId, { actionId });
  };

  const handleExtensionText = async (text: string): Promise<void> => {
    if (!chatId) {
      throw new Error('The active chat is not available.');
    }
    await respondToExtensionInteraction(chatId, {
      actionId: '__input__',
      input: text,
    });
    onAppendMessage(chatId, 'user', text);
  };

  /*
   * Per-turn tool activity store, scoped to THIS chat: accumulates the
   * tool boxes of this chat's running request and attaches them to the
   * assistant message that answers it, so they stay visible above each
   * response. Parallel conversations never share activities.
   */
  const toolActivity = useToolActivity(chatId);
  const [stepWorkflowLogEntries, setStepWorkflowLogEntries] =
    useState<WorkflowLogEntry[]>([]);

  useEffect(() => {
    setStepWorkflowLogEntries([]);
  }, [chatId]);

  /*
   * Step-workflow tool calls are persisted separately from regular agent
   * activities. Load them for this chat and refresh while a turn is running
   * so the same compact activity cards can appear under the matching user
   * message in real time.
   */
  useEffect(() => {
    if (!chatId) {
      setStepWorkflowLogEntries([]);
      return;
    }

    let cancelled = false;
    let loading = false;

    const loadLogs = async () => {
      if (cancelled || loading) {
        return;
      }

      loading = true;

      try {
        const result = await getStepWorkflowLogs(
          chatId,
          null,
          0,
          Number.MAX_SAFE_INTEGER,
        );
        const all = result.entries;

        if (!cancelled) {
          setStepWorkflowLogEntries((current) => {
            // Completing/canceling a workflow clears its active chat pointer.
            // Keep the already-loaded turn logs visible in this chat instead
            // of erasing them on the final refresh.
            if (all.length === 0 && current.length > 0) {
              return current;
            }

            const unchanged = current.length === all.length &&
              current.every((entry, index) =>
                entry.id === all[index]?.id &&
                entry.preview === all[index]?.preview,
              );

            return unchanged ? current : all;
          });
        }
      } catch {
        // Workflow logging is supplemental; it must not interrupt chat.
      } finally {
        loading = false;
      }
    };

    void loadLogs();

    if (!isLoading) {
      return () => {
        cancelled = true;
      };
    }

    const interval = window.setInterval(() => {
      void loadLogs();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [chatId, isLoading, messages.length]);

  /*
   * Names of every available skill, extension, and agent, so sent user
   * messages highlight exactly the selected resource names.
   */
  const mentionResourceNames = useMentionResources();

  /*
   * Background project-memory save status of THIS chat. The status is
   * scoped to the chat id, so a save running in another conversation
   * never shows its mind icon here.
   */
  const memorySaveStatus =
    useMemorySaveStatus(chatId);

  /*
   * Messages loaded from the selected project's persisted memory.
   */
  const [
    projectMemoryMessages,
    setProjectMemoryMessages,
  ] = useState<ChatMessage[]>([]);

  const bottomAnchorRef =
    useRef<HTMLDivElement | null>(null);

  /*
   * NOTE: the running request no longer lives in this component. Abort
   * controllers and loading state are owned by the per-chat run store
   * (chatRuns.ts). Navigating to another page unmounts ChatBox, but that
   * must never abort the agent — the run simply continues and the view
   * re-attaches when the user comes back. The stop button aborts only
   * the run of the chat it is displayed for.
   */

  const messagesRef = useRef<BaseMessage[]>(
    convertToLangChainMessages(messages),
  );

  /*
   * LangChain representation of the selected project's memory.
   */
  const projectMemoryRef =
    useRef<BaseMessage[]>([]);

  /*
   * Visible representation of the selected project's memory.
   */
  const projectMemoryMessagesRef =
    useRef<ChatMessage[]>([]);

  /*
   * Tracks which project folder has already been loaded.
   */
  const projectMemoryLoadStateRef =
    useRef<string>('');

  /*
   * Loads the persisted memory for a project folder.
   */
  const loadProjectMemoryForFolder = useCallback(
    async (path: string): Promise<void> => {
      const normalizedPath = path.trim();

      if (!normalizedPath) {
        projectMemoryRef.current = [];
        projectMemoryMessagesRef.current = [];
        projectMemoryLoadStateRef.current = '';
        setProjectMemoryMessages([]);

        return;
      }

      try {
        const memory = await loadShortTermMemory({
          projectPath: normalizedPath,
        });

        const baseMessages =
          memory.exchanges.flatMap(
            (exchange) => [
              new HumanMessage(
                exchange.userMessage,
              ),
              new AIMessage(
                exchange.agentResponse,
              ),
            ],
          );

        const chatMessages: ChatMessage[] =
          memory.exchanges.flatMap(
            (exchange) => [
              {
                id: `memo-${exchange.id}-user`,
                role: 'user',
                content:
                  exchange.userMessage,
                createdAt:
                  exchange.createdAt,
              },
              {
                id: `memo-${exchange.id}-assistant`,
                role: 'assistant',
                content:
                  exchange.agentResponse,
                createdAt:
                  exchange.createdAt,
              },
            ],
          );

        projectMemoryRef.current =
          baseMessages;

        projectMemoryMessagesRef.current =
          chatMessages;

        projectMemoryLoadStateRef.current =
          normalizedPath;

        setProjectMemoryMessages(
          chatMessages,
        );
      } catch (memoryError) {
        console.error(
          '[Chat Memory] Failed to load project memory:',
          memoryError,
        );

        projectMemoryRef.current = [];
        projectMemoryMessagesRef.current = [];

        /*
         * Mark the folder as loaded even when no memory exists or
         * loading fails, preventing repeated reads on every message.
         */
        projectMemoryLoadStateRef.current =
          normalizedPath;

        setProjectMemoryMessages([]);
      }
    },
    [],
  );

  useEffect(() => {
    messagesRef.current =
      convertToLangChainMessages(messages);
  }, [chatId, messages]);

  /*
   * Reload project memory whenever the selected project changes.
   */
  useEffect(() => {
    projectMemoryRef.current = [];
    projectMemoryMessagesRef.current = [];
    projectMemoryLoadStateRef.current = '';

    setProjectMemoryMessages([]);

    const normalizedProjectPath =
      projectPath.trim();

    if (normalizedProjectPath) {
      void loadProjectMemoryForFolder(
        normalizedProjectPath,
      );
    }
  }, [
    projectPath,
    loadProjectMemoryForFolder,
  ]);

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [
    messages,
    projectMemoryMessages,
    isLoading,
  ]);

  useEffect(() => {
    /*
     * Clear transient view state whenever the displayed conversation
     * changes. The agent run of the previous chat is intentionally left
     * alone: it keeps running in the background.
     */
    setDraftMessage('');
    projectMemoryRef.current = [];
  }, [chatId]);

  const handleSendMessage = async (
    text: string,
    options?: SendOptions,
  ): Promise<void> => {
    const normalizedText = text.trim();

    /*
     * Block a second send only while THIS conversation is busy: its own
     * agent run is active, or its conversation is still being created.
     * Other chats keep running in the background and are untouched.
     */
    if (!normalizedText || isLoading) {
      return;
    }

    /*
     * Lock the input while the chat is being created or resumed.
     */
    setIsPreparingChat(true);

    /*
     * Prefer the path sent directly by ChatInput. This handles the case
     * where the projectPath prop has not been updated by React yet.
     */
    const effectiveProjectPath =
      options?.projectPath?.trim() ||
      projectPath.trim() ||
      '';

    /*
     * This value determines which agent should process the request.
     */
    const hasSelectedProject =
      effectiveProjectPath.length > 0;

    let requestChatId: string;
    let wasCreated: boolean;

    try {
      /* Focus requests and active Focus turns do not load global project memory. */
      const isFocusTurn =
        parseFocusStartGoal(normalizedText) !== null ||
        Boolean(chatId && await hasActiveFocusSession(chatId));

      /*
       * Load project memory before creating the chat only for normal turns.
       */
      if (
        !isFocusTurn &&
        hasSelectedProject &&
        projectMemoryLoadStateRef.current !==
          effectiveProjectPath
      ) {
        await loadProjectMemoryForFolder(
          effectiveProjectPath,
        );
      }

      /*
       * Only project conversations should receive project history.
       */
      const initialHistory =
        hasSelectedProject && !isFocusTurn
          ? projectMemoryMessagesRef.current
          : [];

      const result = await onEnsureChat(
        normalizedText,
        effectiveProjectPath,
        initialHistory,
      );

      requestChatId = result.chatId;
      wasCreated = result.wasCreated;

      /*
       * New turn in this chat: drop the previous turn's memory-save
       * status, so its mind icon does not linger below the response
       * that is about to be generated.
       */
      clearMemorySaveStatus(requestChatId);

      /*
       * A brand-new chat keeps its pinned resources under the reserved
       * "new chat" key until the first message creates it. Hand the
       * selection over to the real chat id so the toggled resources
       * stay active for the conversation that was just created.
       */
      if (wasCreated) {
        migrateNewChatResourceSelection(requestChatId);
      }
    } catch (error) {
      console.error(
        '[Chat Box] Failed to create or resume the conversation:',
        error,
      );

      setIsPreparingChat(false);

      /*
       * Let ChatInput restore the draft and selected resources. Swallowing this
       * error makes a failed project resume look like a successful send and
       * leaves the user on an empty New chat page with no explanation.
       */
      throw error;
    }

    /*
     * A newly created chat already contains its first user message.
     */
    if (!wasCreated) {
      onAppendMessage(
        requestChatId,
        'user',
        normalizedText,
      );
    }

    setDraftMessage('');

    setIsPreparingChat(false);

    /*
     * Register this chat's run in the per-chat store. The controller is
     * owned by the store, not by this component, so navigating away or
     * switching chats never aborts it. Only this chat's stop button does.
     */
    const controller = beginChatRun(requestChatId);

    /*
     * Route any recovered extension result back to this conversation if
     * the webview reloads while a long extension command is running.
     */
    setActiveRequestChat(requestChatId);

    /*
     * While a request runs, dev-server full reloads (triggered by files
     * the agent edits) must not kill it — the guard blocks them until
     * the request finishes.
     */
    beginGuardedRun();

    /*
     * The tool boxes of this request start empty; other chats' boxes are
     * untouched.
     */
    toolActivity.beginRequest(requestChatId);

    const currentHistory =
      chatId === requestChatId
        ? messagesRef.current
        : [];

    const existingUserTexts =
      new Set<string>(
        currentHistory
          .filter(
            (message) =>
              message.getType() ===
              'human',
          )
          .map((message) =>
            String(
              message.content,
            ).trim(),
          ),
      );

    /*
     * Project memory is included only when a project folder is selected.
     */
    const memoryHistory =
      hasSelectedProject
        ? projectMemoryRef.current.filter(
            (message) => {
              if (
                message.getType() !==
                'human'
              ) {
                return true;
              }

              return !existingUserTexts.has(
                String(
                  message.content,
                ).trim(),
              );
            },
          )
        : [];

    const nextMessages: BaseMessage[] = [
      ...memoryHistory,
      ...currentHistory,
      new HumanMessage(
        resolveFileMentions(normalizedText, options?.fileReferences ?? []),
      ),
    ];

    try {
      const agentState = {
        messages: nextMessages,
        memoryContext: '',
      };

      const agentConfig = {
        signal: controller.signal,
        configurable: {
          /*
           * Each conversation uses its own LangGraph thread.
           */
          thread_id: requestChatId,
          /*
           * The id of the conversation that owns this run. Every tool
           * activity event the agents dispatch is scoped to it, so
           * parallel chats each see only their own tool boxes.
           */
          [CHAT_ID_CONFIG_KEY]: requestChatId,
          /*
           * Skills selected with the /skill command are resolved inside
           * the agent into their SKILL.md system-prompt content.
           */
          selectedSkills:
            options?.selectedSkills?.map(
              (skill) => skill.name,
            ) ?? [],
          /*
           * Extensions selected with the /extension command are run
           * inside the agent and their output is added to the system
           * prompt.
           */
          selectedExtensions:
            options?.selectedExtensions?.map(
              (extension) => extension.id,
            ) ?? [],
          /*
           * MCP servers selected with the /mcp command expose their
           * discovered tools to the agent as callable tools.
           */
          selectedMcpServers:
            options?.selectedMcpServers?.map(
              (server) => server.id,
            ) ?? [],
          selectedAgent:
            options?.selectedAgent?.name ?? null,
          projectDescription,
          /*
           * Model override chosen in the composer model picker. Only the
           * main agents (chat agent and project agent) read this key;
           * every other agent keeps its own configured model.
           */
          selectedModel:
            options?.selectedModel?.trim() || null,
          reasoningEffort:
            options?.selectedReasoningEffort ?? null,
        },
      };

      /*
       * Use the project agent only when the user has selected a project
       * folder. Otherwise, use the regular chat agent.
       */
      const agentResult =
        hasSelectedProject
          ? await callProjectAgent(
              agentState,
              effectiveProjectPath,
              agentConfig,
            )
          : await callChatAgent(
              agentState,
              agentConfig,
            );

      if (controller.signal.aborted) {
        return;
      }

      const lastAssistantMessage =
        agentResult.messages[
          agentResult.messages.length - 1
        ];

      if (!lastAssistantMessage) {
        throw new Error(
          hasSelectedProject
            ? 'The project agent returned no assistant message.'
            : 'The chat agent returned no assistant message.',
        );
      }

      const response =
        typeof lastAssistantMessage.content ===
        'string'
          ? lastAssistantMessage.content.trim()
          : '';

      if (!response) {
        throw new Error(
          hasSelectedProject
            ? 'The project agent returned an empty response.'
            : 'The chat agent returned an empty response.',
        );
      }

      messagesRef.current = [
        ...nextMessages,
        lastAssistantMessage,
      ];

      const assistantMessage = onAppendMessage(
        requestChatId,
        'assistant',
        response,
      );

      /*
       * Attach the tool boxes used for this request to the response
       * message, so they remain visible above it.
       */
      toolActivity.commit(
        assistantMessage.id,
      );

      /* Focus stays isolated from the ordinary short-memory store. */
      const isFocusResponse =
        lastAssistantMessage instanceof AIMessage &&
        lastAssistantMessage.additional_kwargs?.mocuFocus === true;

      if (!isFocusResponse) {
        try {
          const saveResult = await saveShortTermMemory({
            userMessage: normalizedText,
            agentResponse: response,
            projectPath: effectiveProjectPath,
          });

          console.log(
            `[Short Memory] Saved for chat ${requestChatId}:`,
            saveResult,
          );
        } catch (memoryError) {
          console.error(
            `[Short Memory] Failed for chat ${requestChatId}:`,
            memoryError,
          );
        }
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        isAbortError(error)
      ) {
        return;
      }

      const activeAgentName =
        hasSelectedProject
          ? 'Project Agent'
          : 'Chat Agent';

      console.error(
        `[${activeAgentName}] Request failed for chat ${requestChatId}:`,
        error,
      );

      const failureContent =
        error instanceof ProjectAgentModelError
          ? [
              `The model request failed after ${error.attempts} attempt${error.attempts === 1 ? '' : 's'}.`,
              '',
              PROJECT_AGENT_PARTIAL_PROGRESS_MARKER,
              error.progressSummary.length > 0
                ? error.progressSummary.join('\n\n')
                : 'No project tool actions completed before the model error.',
            ].join('\n')
          : 'Sorry, I encountered an error while processing that request.';
      const errorMessage = onAppendMessage(
        requestChatId,
        'assistant',
        failureContent,
      );

      /*
       * Even on failure, keep the tools that already ran attached to
       * the error message so the user can inspect them.
       */
      toolActivity.commit(
        errorMessage.id,
      );
    } finally {
      /*
       * End this chat's run (other chats keep theirs), then release the
       * dev-reload guard and the recovery routing only when no chat is
       * running anymore.
       */
      endChatRun(requestChatId, controller);

      endGuardedRun();

      if (!hasAnyChatRun()) {
        setActiveRequestChat(null);
      }
    }
  };

  const handleStopGeneration = (): void => {
    /*
     * Stop only THIS chat's run. Every other conversation keeps working.
     */
    abortChatRun(chatId);
  };

  const handleEditMessage = useCallback(
    (message: ChatMessage): void => {
      setDraftMessage(message.content);
    },
    [],
  );

  const hasMessages =
    messages.length > 0 ||
    projectMemoryMessages.length > 0;

  /*
   * Stable element identity for the memory-save footer of the last
   * assistant message. Without useMemo a new element would be created
   * on every keystroke, re-rendering the last response each time.
   */
  const memoryFooter = useMemo(
    () => <MemorySaveIndicator status={memorySaveStatus} />,
    [memorySaveStatus],
  );

  /*
   * Show project memory for a new project chat. Once the conversation
   * has its own messages, display those messages instead.
   */
  const displayMessages =
    messages.length > 0
      ? messages
      : projectMemoryMessages;

  const stepWorkflowMessageMapping = useMemo(
    () => buildWorkflowMessageMapping(
      stepWorkflowLogEntries,
      displayMessages,
      resumableWorkflow?.id ?? null,
    ),
    [stepWorkflowLogEntries, displayMessages, resumableWorkflow?.id],
  );
  const focusMessageMapping = useMemo(
    () => buildFocusMessageMapping(
      focusChatTurns,
      displayMessages,
      resumableFocus?.id ?? null,
    ),
    [focusChatTurns, displayMessages, resumableFocus?.id],
  );
  const chatThreadMarkers = useMemo(() => {
    const markers = new Map(stepWorkflowMessageMapping.threadMarkers);
    focusMessageMapping.forEach((marker, messageId) => markers.set(messageId, marker));
    return markers;
  }, [stepWorkflowMessageMapping.threadMarkers, focusMessageMapping]);

  /*
   * Workflow logs remain the fallback for older conversations, but live
   * workflow tool calls now also use the regular per-turn activity feed.
   * Hide log copies already present there to avoid rendering each box twice.
   */
  const renderedToolActivityIds = new Set(
    toolActivity.pendingActivities.map((activity) => activity.id),
  );

  for (const message of displayMessages) {
    if (message.role === 'assistant') {
      for (const activity of toolActivity.getForMessage(message.id)) {
        renderedToolActivityIds.add(activity.id);
      }
    }
  }

  /*
   * The mind icon sits directly below the agent's latest response
   * (rendered inside that message, above its action buttons).
   */
  let lastAssistantIndex = -1;

  for (
    let index = displayMessages.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (
      displayMessages[index].role ===
      'assistant'
    ) {
      lastAssistantIndex = index;

      break;
    }
  }

  const retryFromAssistantMessage = (messageIndex: number): void => {
    for (let index = messageIndex - 1; index >= 0; index -= 1) {
      const previousMessage = displayMessages[index];
      if (previousMessage.role === 'user') {
        void handleSendMessage(previousMessage.content);
        return;
      }
    }
  };

  return (
    <section
      className="chat-box"
      aria-label={`Chat with ${agentName}`}
    >
      {hasMessages ? (
        <div
          className="chat-box-messages"
          aria-live="polite"
        >
          <div className="chat-box-messages-inner">
            {displayMessages.map((message, messageIndex) => {
              const thread = chatThreadMarkers.get(message.id);
              const rowClass = thread
                ? `chat-thread-row chat-thread-row--${thread.type} chat-thread-row--${thread.position}`
                : 'chat-thread-row';
              const sectionLabel = thread?.type === 'focus'
                ? `Focus · Section ${thread.sectionNumber}`
                : `Step-by-Step · Step ${thread?.sectionNumber}`;

              return (
                <div className={rowClass} key={message.id}>
                  {thread?.label ? <span className="chat-thread-label">{sectionLabel}</span> : null}
                  {message.role === 'user' ? (
                    <>
                      <EditableUserMessage
                        message={message}
                        resourceNames={mentionResourceNames}
                        onEdit={handleEditMessage}
                      />
                      <ToolActivityFeed
                        activities={(
                          stepWorkflowMessageMapping.activitiesByMessage.get(message.id) ?? []
                        ).filter((activity) => !renderedToolActivityIds.has(activity.id))}
                      />
                    </>
                  ) : (
                    <>
                      <ToolActivityFeed activities={toolActivity.getForMessage(message.id)} />
                      <AssistantMessage
                        content={message.content}
                        footer={messageIndex === lastAssistantIndex ? memoryFooter : undefined}
                        failureDetails={getProjectAgentFailureDetails(message.content)}
                        onRegenerate={message.content.includes(PROJECT_AGENT_PARTIAL_PROGRESS_MARKER)
                          ? () => retryFromAssistantMessage(messageIndex)
                          : undefined}
                      />
                    </>
                  )}
                  {thread?.canResume ? (
                    <button
                      type="button"
                      className="chat-thread-resume"
                      disabled={resumingType !== null}
                      onClick={() => void (thread.type === 'focus' ? handleResumeFocus() : handleResumeWorkflow())}
                    >
                      {resumingType === thread.type ? 'Resuming…' : thread.type === 'focus' ? 'Resume Focus' : 'Resume Step-by-Step'}
                    </button>
                  ) : null}
                </div>
              );
            })}

            {/*
              * Live tool boxes of the request that is currently
              * running. Once the response arrives they are committed
              * to that message and move above it.
              */}
            {isLoading ? (
              <ToolActivityFeed
                activities={
                  toolActivity.pendingActivities
                }
              />
            ) : null}

            {isLoading ? (
              <ChatStatusBubble
                agentName={agentName}
                isLoading={isLoading}
              />
            ) : null}

            <div
              ref={bottomAnchorRef}
              className="chat-box-messages-anchor"
              aria-hidden="true"
            />
          </div>
        </div>
      ) : (
        <div className="chat-box-empty">
          <div
            className="chat-box-empty-icon"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="27"
              height="27"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.55"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3a8.5 8.5 0 0 0-7.25 12.95L4 20l4.05-.75A8.5 8.5 0 1 0 12 3Z" />
              <path d="M8.5 10.2h.01" />
              <path d="M12 10.2h.01" />
              <path d="M15.5 10.2h.01" />
            </svg>
          </div>

          <h2 className="chat-box-empty-title">
            What can I help you with?
          </h2>

          <p className="chat-box-empty-description">
            Ask questions, plan your work, or start
            building something with {agentName}.
          </p>
        </div>
      )}

      <ChatInput
        key={chatId ?? 'new-chat'}
        chatId={chatId}
        value={draftMessage}
        onValueChange={setDraftMessage}
        onSend={handleSendMessage}
        onStop={handleStopGeneration}
        isLoading={isLoading}
        interactionActive={Boolean(extensionInteraction)}
        interactionInputEnabled={
          Boolean(extensionInteraction?.inputEnabled) &&
          !extensionInteraction?.isResponding
        }
        interactionInputPlaceholder={extensionInteraction?.inputPlaceholder}
        onInteractionSend={handleExtensionText}
        interaction={extensionInteraction}
        onInteractionChoose={(actionId) => {
          void handleExtensionAction(actionId).catch((error) =>
            console.error('[Extension Interaction] Reply failed:', error),
          );
        }}
        agentName={agentName}
        projectPath={projectPath}
      />
    </section>
  );
}