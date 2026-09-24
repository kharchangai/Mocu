import {
  memo,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { MarkdownRenderer } from "./markdown";

import "./AssistantMessage.css";

type AssistantMessageProps = {
  content: string;
  failureDetails?: {
    summary: string;
    progress: string;
  };
  onRegenerate?: () => void;

  /*
   * Optional content rendered directly below the response text and
   * above the action buttons (e.g. the memory save mind icon).
   */
  footer?: ReactNode;
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

function AssistantMessageImpl({
  content,
  footer,
  failureDetails,
  onRegenerate,
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
      {failureDetails ? (
        <section
          className="assistant-failure-card"
          role="alert"
          aria-label="Project agent request failed"
        >
          <div className="assistant-failure-card__heading">
            <span
              className="assistant-failure-card__icon"
              aria-hidden="true"
            >
              !
            </span>
            <div>
              <p className="assistant-failure-card__eyebrow">
                Request interrupted
              </p>
              <h3>The agent couldn’t finish this task</h3>
            </div>
          </div>

          <p className="assistant-failure-card__summary">
            {failureDetails.summary}
          </p>

          <div className="assistant-failure-card__saved">
            Completed work and tool results are saved with this conversation.
            Retry to continue from that progress.
          </div>

          {failureDetails.progress ? (
            <details className="assistant-failure-card__details">
              <summary>View completed work</summary>
              <pre>{failureDetails.progress}</pre>
            </details>
          ) : null}

          {onRegenerate ? (
            <button
              type="button"
              className="assistant-failure-card__retry"
              onClick={onRegenerate}
            >
              <RetryIcon />
              <span>Retry from saved progress</span>
            </button>
          ) : null}
        </section>
      ) : (
        <div className="assistant-message__body">
          <MarkdownRenderer
            content={content}
            direction="auto"
          />
        </div>
      )}

      {footer}

      <div
        className="assistant-message__actions"
        aria-label="Response actions"
      >
        <button
          type="button"
          className="assistant-message__action"
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

      </div>
    </article>
  );
}

/*
 * Memoized so typing in the composer does not re-render (and re-run
 * markdown parsing for) older messages whose content did not change.
 */
export const AssistantMessage = memo(AssistantMessageImpl);