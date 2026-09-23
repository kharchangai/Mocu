import {
  Fragment,
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
import { callProjectAgent } from '../../services/ai/project-agent';
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
} from '../services/toolActivity';

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
};

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

  /*
   * Busy state of THIS chat. The run store lives outside React, so a
   * running request keeps going when the user navigates to another page
   * or switches chats, and this flag picks the state back up when the
   * view returns.
   */
  const isChatBusy = useIsChatRunActive(chatId);

  const isLoading = isChatBusy || isPreparingChat;
  const extensionInteraction = useExtensionInteraction(chatId);

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
      /*
       * Load project memory before creating the chat.
       */
      if (
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
        hasSelectedProject
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
      new HumanMessage(normalizedText),
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

      /*
       * Preserve the existing short-memory behavior.
       */
      try {
        const saveResult =
          await saveShortTermMemory({
            userMessage: normalizedText,
            agentResponse: response,
            projectPath:
              effectiveProjectPath,
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

      const errorMessage =
        onAppendMessage(
          requestChatId,
          'assistant',
          'Sorry, I encountered an error while processing that request.',
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
            {displayMessages.map(
              (message, messageIndex) =>
                message.role === 'user' ? (
                  <EditableUserMessage
                    key={message.id}
                    message={message}
                    resourceNames={mentionResourceNames}
                    onEdit={handleEditMessage}
                  />
                ) : (
                  <Fragment
                    key={message.id}
                  >
                    {/*
                      * Tool boxes of this turn: shown below the user's
                      * message and above this response, and they stay
                      * there after the answer arrives.
                      */}
                    <ToolActivityFeed
                      activities={toolActivity.getForMessage(
                        message.id,
                      )}
                    />

                    <AssistantMessage
                      content={
                        message.content
                      }
                      footer={
                        messageIndex ===
                        lastAssistantIndex ? (
                          memoryFooter
                        ) : undefined
                      }
                    />
                  </Fragment>
                ),
            )}

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