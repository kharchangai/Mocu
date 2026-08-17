// src/chat/components/ChatInput.tsx

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

type ChatInputProps = {
  value: string;
  isLoading?: boolean;
  agentName?: string;
  modelLabel?: string;
  effortLabel?: string;
  onValueChange: (value: string) => void;
  onSend: (text: string) => void | Promise<void>;
  onStop?: () => void;
};

const MAX_TEXTAREA_HEIGHT = 180;

export function ChatInput({
  value,
  isLoading = false,
  agentName = 'Mocu',
  modelLabel = 'Mocu · Standard',
  effortLabel = 'Balanced',
  onValueChange,
  onSend,
  onStop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = () => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';

    const nextHeight = Math.min(
      textarea.scrollHeight,
      MAX_TEXTAREA_HEIGHT,
    );

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_TEXTAREA_HEIGHT
        ? 'auto'
        : 'hidden';
  };

  useEffect(() => {
    resizeTextarea();
  }, [value]);

  const handleChange = (
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    onValueChange(event.target.value);
  };

  const handleSend = () => {
    const text = value.trim();

    if (!text || isLoading) {
      return;
    }

    onValueChange('');
    void onSend(text);

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    });
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      handleSend();
    }
  };

  const canSend = value.trim().length > 0 && !isLoading;

  return (
    <footer className="chat-input-area">
      <div className="chat-input-container">
        <div className="chat-input">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${agentName}`}
            className="chat-input-field"
            rows={1}
            dir="auto"
            aria-label={`Message ${agentName}`}
          />

          <div className="chat-input-toolbar">
            <div className="chat-input-toolbar-left">
              <button
                type="button"
                className="chat-input-icon-button"
                title="Attach file"
                aria-label="Attach file"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="17"
                  height="17"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>

              <button
                type="button"
                className="chat-input-pill-button"
              >
                <span>{modelLabel}</span>

                <svg
                  viewBox="0 0 24 24"
                  width="11"
                  height="11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </button>

              <button
                type="button"
                className="chat-input-pill-button"
              >
                <span>{effortLabel}</span>

                <svg
                  viewBox="0 0 24 24"
                  width="11"
                  height="11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m7 10 5 5 5-5" />
                </svg>
              </button>
            </div>

            <div className="chat-input-toolbar-right">
              <button
                type="button"
                className="chat-input-icon-button"
                title="Voice input"
                aria-label="Voice input"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="2" width="6" height="11" rx="3" />
                  <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                  <path d="M12 18v3" />
                </svg>
              </button>

              {isLoading ? (
                <button
                  type="button"
                  className="chat-input-send-button chat-input-stop-button"
                  onClick={onStop}
                  aria-label="Stop generation"
                  title="Stop generation"
                >
                  <span className="chat-input-stop-icon" />
                </button>
              ) : (
                <button
                  type="button"
                  className="chat-input-send-button"
                  disabled={!canSend}
                  onClick={handleSend}
                  aria-label="Send message"
                  title="Send message"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 19V5" />
                    <path d="m6 11 6-6 6 6" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="chat-input-hint">
          Mocu can make mistakes. Check important information.
        </p>
      </div>
    </footer>
  );
}