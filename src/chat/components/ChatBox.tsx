import {
  useCallback,
  useEffect,
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

import { callChatAgent } from '../../services/ai/chat-agent';
import { callProjectAgent } from '../../services/ai/project-agent';
import { isAbortError } from '../../services/aiService';

import {
  loadShortTermMemory,
  saveShortTermMemory,
} from '../services/shortTermMemory';

import type { ChatMessage } from '../types/chat';

import type { SelectedSkill } from './skillTypes';
import type { SelectedExtension } from './extensionTypes';

import './ChatBox.css';

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
};

type ChatBoxProps = {
  chatId: string | null;
  messages: ChatMessage[];
  agentName?: string;
  projectPath?: string;

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

  onProjectPathChange?: (path: string) => void;
  onChooseProjectFolder?: () => void | Promise<void>;
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
  onEnsureChat,
  onAppendMessage,
  onProjectPathChange,
  onChooseProjectFolder,
}: ChatBoxProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');

  /*
   * Messages loaded from the selected project's persisted memory.
   */
  const [
    projectMemoryMessages,
    setProjectMemoryMessages,
  ] = useState<ChatMessage[]>([]);

  const bottomAnchorRef =
    useRef<HTMLDivElement | null>(null);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  const activeRequestChatIdRef =
    useRef<string | null>(null);

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
     * Clear transient state whenever the active conversation changes.
     */
    setDraftMessage('');
    projectMemoryRef.current = [];

    const hasActiveRequest =
      activeRequestChatIdRef.current !== null;

    const belongsToThisChat =
      activeRequestChatIdRef.current === chatId;

    /*
     * Abort the request only when switching away from the conversation
     * that owns the active request.
     */
    if (
      hasActiveRequest &&
      !belongsToThisChat
    ) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      activeRequestChatIdRef.current = null;

      setIsLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      activeRequestChatIdRef.current = null;
    };
  }, []);

  const handleSendMessage = async (
    text: string,
    options?: SendOptions,
  ): Promise<void> => {
    const normalizedText = text.trim();

    if (!normalizedText || isLoading) {
      return;
    }

    /*
     * Lock the input while the chat is being created or resumed.
     */
    setIsLoading(true);

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
    } catch (error) {
      console.error(
        '[Chat Box] Failed to create or resume the conversation:',
        error,
      );

      setIsLoading(false);

      return;
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

    abortControllerRef.current?.abort();

    const controller =
      new AbortController();

    abortControllerRef.current =
      controller;

    activeRequestChatIdRef.current =
      requestChatId;

    setIsLoading(true);

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

      onAppendMessage(
        requestChatId,
        'assistant',
        response,
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

      onAppendMessage(
        requestChatId,
        'assistant',
        'Sorry, I encountered an error while processing that request.',
      );
    } finally {
      if (
        abortControllerRef.current ===
        controller
      ) {
        abortControllerRef.current = null;
        activeRequestChatIdRef.current = null;

        setIsLoading(false);
      }
    }
  };

  const handleStopGeneration = (): void => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeRequestChatIdRef.current = null;

    setIsLoading(false);
  };

  const handleEditMessage = (
    message: ChatMessage,
  ): void => {
    setDraftMessage(message.content);
  };

  const hasMessages =
    messages.length > 0 ||
    projectMemoryMessages.length > 0;

  /*
   * Show project memory for a new project chat. Once the conversation
   * has its own messages, display those messages instead.
   */
  const displayMessages =
    messages.length > 0
      ? messages
      : projectMemoryMessages;

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
              (message) =>
                message.role === 'user' ? (
                  <UserMessage
                    key={message.id}
                    content={message.content}
                    onEdit={() =>
                      handleEditMessage(
                        message,
                      )
                    }
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    content={message.content}
                  />
                ),
            )}

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
        value={draftMessage}
        onValueChange={setDraftMessage}
        onSend={handleSendMessage}
        onStop={handleStopGeneration}
        isLoading={isLoading}
        agentName={agentName}
        projectPath={projectPath}
        onProjectPathChange={
          onProjectPathChange
        }
        onChooseProjectFolder={
          onChooseProjectFolder
        }
      />
    </section>
  );
}