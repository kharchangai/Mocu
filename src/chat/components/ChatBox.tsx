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
import { isAbortError } from '../../services/aiService';
import {
  loadShortTermMemory,
  saveShortTermMemory,
} from '../services/shortTermMemory';

import type { ChatMessage } from '../types/chat';

import './ChatBox.css';

type EnsureChatResult = {
  chatId: string;
  wasCreated: boolean;
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
   * Messages read from the project's persisted memory history
   * (<projectPath>/.mocu/memory/short.json) so a new chat can show
   * all past conversations for the selected folder.
   */
  const [projectMemoryMessages, setProjectMemoryMessages] =
    useState<ChatMessage[]>([]);

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
   * Cached representation of the project's persisted memory history
   * (<projectPath>/.mocu/memory/short.json). It is loaded once per
   * project folder and reset whenever the folder or conversation changes.
   */
  const projectMemoryRef = useRef<BaseMessage[]>([]);

  /*
   * Visible representation of the loaded project memory, reused when
   * creating a chat so the past history is persisted with it.
   */
  const projectMemoryMessagesRef =
    useRef<ChatMessage[]>([]);

  /*
   * Project folder that has already been read. Avoids re-reading an
   * empty memory file on every message.
   */
  const projectMemoryLoadStateRef = useRef<string>('');

  /*
   * Loads the project's persisted memory history once and stores it
   * both as visible chat messages and as agent-context messages.
   */
  const loadProjectMemoryForFolder = useCallback(
    async (path: string): Promise<void> => {
      try {
        const memory = await loadShortTermMemory({
          projectPath: path,
        });

        const baseMessages = memory.exchanges.flatMap(
          (exchange) => [
            new HumanMessage(exchange.userMessage),
            new AIMessage(exchange.agentResponse),
          ],
        );

        const chatMessages: ChatMessage[] =
          memory.exchanges.flatMap((exchange) => [
            {
              id: `memo-${exchange.id}-user`,
              role: 'user',
              content: exchange.userMessage,
              createdAt: exchange.createdAt,
            },
            {
              id: `memo-${exchange.id}-assistant`,
              role: 'assistant',
              content: exchange.agentResponse,
              createdAt: exchange.createdAt,
            },
          ]);

        projectMemoryRef.current = baseMessages;
        projectMemoryMessagesRef.current = chatMessages;
        projectMemoryLoadStateRef.current = path;
        setProjectMemoryMessages(chatMessages);
      } catch (memoryError) {
        console.error(
          '[Chat Memory] Failed to load project memory:',
          memoryError,
        );

        projectMemoryRef.current = [];
        projectMemoryMessagesRef.current = [];
        projectMemoryLoadStateRef.current = path;
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
   * Reload the project memory whenever the active project folder
   * changes so a newly selected folder is read from scratch.
   */
  useEffect(() => {
    projectMemoryRef.current = [];
    projectMemoryMessagesRef.current = [];
    projectMemoryLoadStateRef.current = '';
    setProjectMemoryMessages([]);

    const normalizedProjectPath = projectPath?.trim() ?? '';

    if (normalizedProjectPath) {
      void loadProjectMemoryForFolder(normalizedProjectPath);
    }
  }, [projectPath, loadProjectMemoryForFolder]);

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages, projectMemoryMessages, isLoading]);

  useEffect(() => {
    /*
     * Clear transient per-conversation state whenever the active
     * conversation changes.
     */
    setDraftMessage('');
    projectMemoryRef.current = [];

    const hasActiveRequest =
      activeRequestChatIdRef.current !== null;

    const belongsToThisChat =
      activeRequestChatIdRef.current === chatId;

    /*
     * Abort an in-flight request only when switching AWAY from the
     * conversation it belongs to. The chat that is created for the
     * first message must NOT be aborted, otherwise the agent response
     * is cancelled and the user has to repeat the message.
     */
    if (hasActiveRequest && !belongsToThisChat) {
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

  const handleSendMessage = async (text: string) => {
    const normalizedText = text.trim();

    if (!normalizedText || isLoading) {
      return;
    }

    /*
     * Lock the input immediately so a second send cannot start while
     * the conversation is being created or resumed.
     */
    setIsLoading(true);

    let requestChatId: string;
    let wasCreated: boolean;

    try {
      /*
       * Ensure the project memory is loaded before creating the chat so
       * the new conversation is seeded with the past project history.
       */
      if (
        projectPath &&
        projectMemoryLoadStateRef.current !== projectPath
      ) {
        await loadProjectMemoryForFolder(projectPath);
      }

      /*
       * Seed a brand-new chat with the project's past memory so the
       * history is persisted and visible again in Chats afterwards.
       */
      const initialHistory = projectMemoryMessagesRef.current;

      const result = await onEnsureChat(
        normalizedText,
        projectPath,
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
     * A freshly created chat already contains the first user message
     * (its title is derived from it). Only append when reusing an
     * existing conversation, to avoid the first message duplicating.
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

    const controller = new AbortController();

    abortControllerRef.current = controller;
    activeRequestChatIdRef.current = requestChatId;

    setIsLoading(true);

    const currentHistory =
      chatId === requestChatId
        ? messagesRef.current
        : [];

    const existingUserTexts = new Set<string>(
      currentHistory
        .filter(
          (message) =>
            message.getType() === 'human',
        )
        .map((message) =>
          String(message.content).trim(),
        ),
    );

    /*
     * Include the project's persisted memory history
     * (.mocu/memory/short.json) as prior context for the agent,
     * skipping any exchange the current conversation already carries.
     */
    const memoryHistory =
      projectMemoryRef.current.filter((message) => {
        if (message.getType() !== 'human') {
          return true;
        }

        return !existingUserTexts.has(
          String(message.content).trim(),
        );
      });

    const nextMessages: BaseMessage[] = [
      ...memoryHistory,
      ...currentHistory,
      new HumanMessage(normalizedText),
    ];

    try {
      const agentResult = await callChatAgent(
        {
          messages: nextMessages,
          memoryContext: '',
        },
        {
          signal: controller.signal,
          configurable: {
            /*
             * Each conversation uses its own LangGraph thread.
             */
            thread_id: requestChatId,
          },
        },
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
          'The chat agent returned no assistant message.',
        );
      }

      const response =
        typeof lastAssistantMessage.content === 'string'
          ? lastAssistantMessage.content.trim()
          : '';

      if (!response) {
        throw new Error(
          'The chat agent returned an empty response.',
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
       * Memory errors must not remove a successful response.
       * The chat ID is currently used as the agent thread ID.
       */
      try {
        const saveResult = await saveShortTermMemory({
          userMessage: normalizedText,
          agentResponse: response,
          projectPath,
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

      console.error(
        `[Chat Agent] Request failed for chat ${requestChatId}:`,
        error,
      );

      onAppendMessage(
        requestChatId,
        'assistant',
        'Sorry, I encountered an error while processing that request.',
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        activeRequestChatIdRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeRequestChatIdRef.current = null;
    setIsLoading(false);
  };

  const handleEditMessage = (
    message: ChatMessage,
  ) => {
    setDraftMessage(message.content);
  };

  const hasMessages =
    messages.length > 0 ||
    projectMemoryMessages.length > 0;

  /*
   * A new chat that selected a project folder starts by showing the
   * project's persisted memory history. Once a real session exists,
   * that session's own messages are shown instead.
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
            {displayMessages.map((message) =>
              message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  content={message.content}
                  onEdit={() =>
                    handleEditMessage(message)
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
        value={draftMessage}
        onValueChange={setDraftMessage}
        onSend={handleSendMessage}
        onStop={handleStopGeneration}
        isLoading={isLoading}
        agentName={agentName}
        projectPath={projectPath}
        onProjectPathChange={onProjectPathChange}
        onChooseProjectFolder={onChooseProjectFolder}
      />
    </section>
  );
}