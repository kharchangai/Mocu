// src/chat/components/CancelledRunCard.tsx
//
// Compact status card shown where an agent run was cancelled by the user.
//
// Replaces the old wall-of-text checkpoint: one calm card with what
// happened, what was kept, and what the partial answer looked like. The
// "continue" action lives on the refresh button under the user message
// that started the cancelled run.

import { memo, useState } from 'react';

import type { CancelledRunData } from '../services/cancelledRun';

import './CancelledRunCard.css';

const MAX_PREVIEW_CHARS = 420;

type CancelledRunCardProps = {
  data: CancelledRunData;
  /** Number of tool actions that had already run when the user cancelled. */
  toolCount: number;
};

function StopIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function CancelledRunCardImpl({
  data,
  toolCount,
}: CancelledRunCardProps) {
  const [showFullAnswer, setShowFullAnswer] = useState(false);

  const partialAnswer = data.partialAnswer.trim();

  const preview =
    partialAnswer.length > MAX_PREVIEW_CHARS && !showFullAnswer
      ? `${partialAnswer.slice(0, MAX_PREVIEW_CHARS).trimEnd()}…`
      : partialAnswer;

  const toolNames = data.tools.map((tool) => tool.name);
  const failedTools = data.tools.filter(
    (tool) => tool.status === 'error',
  ).length;

  return (
    <article
      className="cancelled-run-card"
      aria-label="Task cancelled"
    >
      <header className="cancelled-run-card__header">
        <span
          className="cancelled-run-card__icon"
          aria-hidden="true"
        >
          <StopIcon />
        </span>

        <div className="cancelled-run-card__titles">
          <p className="cancelled-run-card__eyebrow">
            Task cancelled
          </p>
          <h3 className="cancelled-run-card__title">
            Stopped early — your progress is saved
          </h3>
        </div>
      </header>

      <p className="cancelled-run-card__text">
        {toolCount > 0
          ? `The conversation, the ${toolCount} tool action${toolCount === 1 ? '' : 's'} already run and the partial answer below were kept.`
          : 'The conversation and everything the agent produced up to this point were kept.'}{' '}
        Send a message or use the refresh button to pick up where it stopped.
      </p>

      {partialAnswer ? (
        <div className="cancelled-run-card__answer">
          <div className="cancelled-run-card__answer-head">
            <span className="cancelled-run-card__answer-label">
              Partial answer
            </span>

            {partialAnswer.length > MAX_PREVIEW_CHARS ? (
              <button
                type="button"
                className="cancelled-run-card__toggle"
                onClick={() =>
                  setShowFullAnswer((current) => !current)
                }
                aria-expanded={showFullAnswer}
              >
                {showFullAnswer ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>

          <p className="cancelled-run-card__answer-body">
            {preview}
          </p>
        </div>
      ) : null}

      {toolCount > 0 ? (
        <div className="cancelled-run-card__meta">
          <span className="cancelled-run-card__meta-item">
            <ClockIcon />
            {toolCount} tool action{toolCount === 1 ? '' : 's'} saved
            {failedTools > 0 ? ` · ${failedTools} failed` : ''}
          </span>

          {toolNames.length > 0 ? (
            <span
              className="cancelled-run-card__tools"
              title={toolNames.join(', ')}
            >
              {toolNames.slice(0, 6).map((name, index) => (
                <span
                  className="cancelled-run-card__chip"
                  key={`${name}-${index}`}
                >
                  {name}
                </span>
              ))}

              {toolNames.length > 6 ? (
                <span className="cancelled-run-card__chip cancelled-run-card__chip--more">
                  +{toolNames.length - 6}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/*
 * Memoized so typing in the composer does not re-parse the checkpoint of
 * every earlier cancelled run.
 */
export const CancelledRunCard = memo(CancelledRunCardImpl);