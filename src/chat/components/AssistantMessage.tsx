import {
  useEffect,
  useRef,
  useState,
} from "react";

import { MarkdownRenderer } from "./markdown";

import "./AssistantMessage.css";

type AssistantMessageProps = {
  content: string;
};

function CopyIcon() {
  return (
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
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
      />

      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

function CheckIcon() {
  return (
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
  );
}

function RetryIcon() {
  return (
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
      <path d="M20 11a8 8 0 1 0-2.34 5.66" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}

export function AssistantMessage({
  content,
}: AssistantMessageProps) {
  const [isCopied, setIsCopied] =
    useState(false);

  const copyTimeoutRef =
    useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(
          copyTimeoutRef.current,
        );
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        content,
      );

      setIsCopied(true);

      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(
          copyTimeoutRef.current,
        );
      }

      copyTimeoutRef.current =
        window.setTimeout(() => {
          setIsCopied(false);
          copyTimeoutRef.current = null;
        }, 1500);
    } catch (error: unknown) {
      console.error(
        "Failed to copy the assistant response:",
        error,
      );
    }
  };

  if (!content.trim()) {
    return null;
  }

  return (
    <article
      className="assistant-message"
      aria-label="Mocu response"
    >
      <div className="assistant-message__body">
        <MarkdownRenderer
          content={content}
          direction="auto"
        />
      </div>

      <div
        className="assistant-message__actions"
        aria-label="Response actions"
      >
        <button
          type="button"
          className="assistant-message__action-button"
          onClick={handleCopy}
          aria-label={
            isCopied
              ? "Response copied"
              : "Copy response"
          }
          title={
            isCopied
              ? "Copied"
              : "Copy response"
          }
        >
          {isCopied ? (
            <CheckIcon />
          ) : (
            <CopyIcon />
          )}
        </button>

        <button
          type="button"
          className="assistant-message__action-button"
          aria-label="Regenerate response"
          title="Regenerate response"
        >
          <RetryIcon />
        </button>
      </div>
    </article>
  );
}