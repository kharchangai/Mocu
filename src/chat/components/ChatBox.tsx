// src/chat/components/ChatBox.tsx

import { useEffect, useRef, useState } from 'react';

import { BaseMessage, HumanMessage } from '@langchain/core/messages';

import { ChatInput } from './ChatInput';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { ChatStatusBubble } from './ChatStatusBubble';

import { callChatAgent } from '../../services/ai/chat-agent';
import { isAbortError } from '../../services/aiService';

import './ChatBox.css';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ChatBoxProps = {
  agentName?: string;
};

export function ChatBox({ agentName = 'Mocu' }: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');

  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const threadIdRef = useRef<string>(crypto.randomUUID());
  const messagesRef = useRef<BaseMessage[]>([]);

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages, isLoading]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const handleSendMessage = async (text: string) => {
    const normalizedText = text.trim();

    if (!normalizedText || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: normalizedText,
    };

    setMessages((previousMessages) => [
      ...previousMessages,
      userMessage,
    ]);

    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);

    const nextMessages = [
      ...messagesRef.current,
      new HumanMessage(normalizedText),
    ];

    try {
      const agentResult = await callChatAgent(
        { messages: nextMessages, memoryContext: '' },
        {
          signal: controller.signal,
          configurable: { thread_id: threadIdRef.current },
        },
      );

      if (controller.signal.aborted) {
        return;
      }

      const lastAssistantMessage =
        agentResult.messages[agentResult.messages.length - 1];

      messagesRef.current = [
        ...nextMessages,
        lastAssistantMessage,
      ];

      const response =
        typeof lastAssistantMessage.content === 'string'
          ? lastAssistantMessage.content
          : '';

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response,
      };

      setMessages((previousMessages) => [
        ...previousMessages,
        assistantMessage,
      ]);
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }

      console.error('Agent request failed:', error);

      setMessages((previousMessages) => [
        ...previousMessages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'Sorry, I encountered an error while processing that request.',
        },
      ]);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleStopGeneration = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  };

  const handleEditMessage = (message: ChatMessage) => {
    setDraftMessage(message.content);
  };

  const hasMessages = messages.length > 0;

  return (
    <section className="chat-box" aria-label={`Chat with ${agentName}`}>
      {hasMessages ? (
        <div className="chat-box-messages" aria-live="polite">
          <div className="chat-box-messages-inner">
            {messages.map((message) =>
              message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  content={message.content}
                  onEdit={() => handleEditMessage(message)}
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
          <div className="chat-box-empty-icon" aria-hidden="true">
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
            Ask questions, plan your work, or start building something
            with {agentName}.
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
      />
    </section>
  );
}