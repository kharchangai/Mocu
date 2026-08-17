// src/chat/components/UserMessage.tsx

import { useEffect, useRef, useState } from 'react';

type UserMessageProps = {
  content: string;
  onEdit?: () => void;
};

export function UserMessage({
  content,
  onEdit,
}: UserMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);

      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }

      copyTimeoutRef.current = window.setTimeout(() => {
        setIsCopied(false);
        copyTimeoutRef.current = null;
      }, 1500);
    } catch (error) {
      console.error('Failed to copy the user message:', error);
    }
  };

  return (
    <article className="user-message" aria-label="User message">
      <div className="user-message-group">
        <div className="user-message-bubble" dir="auto">
          {content}
        </div>

        <div className="user-message-actions">
          <button
            type="button"
            className="message-action-button"
            onClick={handleCopy}
            aria-label={isCopied ? 'Message copied' : 'Copy message'}
            title={isCopied ? 'Copied' : 'Copy'}
          >
            {isCopied ? (
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12 4 4L19 6" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>

          {onEdit ? (
            <button
              type="button"
              className="message-action-button"
              onClick={onEdit}
              aria-label="Edit message"
              title="Edit"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}