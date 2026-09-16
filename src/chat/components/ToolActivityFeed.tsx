// src/chat/components/ToolActivityFeed.tsx
//
// Collapsible tool boxes shown inside the chat.
//
// Each tool call the chat/project agent performs is rendered as a
// small card with a human-readable label ("Running a terminal
// command…"). The arrow on the right expands the card to reveal what
// the tool was asked to do (e.g. the executed command) and what
// happened (the tool output).
//
// The component is presentational: the activities come in as props
// from the useToolActivity hook, so boxes can be shown per message
// (below the user's message, above the agent's response) and stay
// visible after the answer arrives.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import type { AgentToolActivity } from '../services/toolActivity';

import './ToolActivityFeed.css';

// Friendly, human-readable label per tool (mirrors the status bubble).
const TOOL_LABELS: Record<string, string> = {
  perplexity_search: 'Searching the web…',
  execute_research_pipeline: 'Running a research pipeline…',
  memory_action: 'Accessing long-term memory…',
  terminal_executor: 'Running a terminal command…',
  desktop_vision_action: 'Looking at your screen…',
  schedule_action: 'Checking the schedule…',
  generate_personalized_prompt: 'Crafting a personalized prompt…',
};

const prettifyToolName = (tool: string): string =>
  tool
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const getToolLabel = (tool: string): string =>
  TOOL_LABELS[tool] ?? `${prettifyToolName(tool)}…`;

/*
 * Best-effort short summary of the tool input for the preview /
 * expanded "Input" section. Well-known keys (command, query, ...) are
 * shown as-is; anything else falls back to pretty-printed JSON.
 */
const describeToolInput = (
  args: Record<string, unknown>,
): string => {
  if (typeof args.command === 'string' && args.command.trim()) {
    return args.command.trim();
  }

  if (typeof args.query === 'string' && args.query.trim()) {
    return args.query.trim();
  }

  if (
    typeof args.task === 'string' &&
    args.task.trim()
  ) {
    return args.task.trim();
  }

  if (!args || Object.keys(args).length === 0) {
    return '';
  }

  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

const truncate = (text: string, maxLength: number): string =>
  text.length > maxLength
    ? `${text.slice(0, maxLength)}…`
    : text;

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

type ToolActivityFeedProps = {
  activities: AgentToolActivity[];
};

export function ToolActivityFeed({
  activities,
}: ToolActivityFeedProps) {
  const [openIds, setOpenIds] = useState<
    Set<string>
  >(new Set());

  if (activities.length === 0) {
    return null;
  }

  const toggleOpen = (id: string): void => {
    setOpenIds((previous) => {
      const next = new Set(previous);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  return (
    <div
      className="tool-activity-feed"
      aria-label="Agent tool activity"
    >
      <AnimatePresence initial={false}>
        {activities.map(
          (activity) => {
            const isOpen =
              openIds.has(activity.id);

            const isRunning =
              activity.status ===
              'running';

            /*
             * Streaming cards belong to extension commands whose manifest
             * declares `streaming: true`. They receive live progress
             * updates while running and show a live output panel.
             */
            const isStreaming =
              isRunning &&
              activity.streaming === true;

            const accent =
              activity.status ===
              'done'
                ? '#4d8f5a'
                : activity.status ===
                    'error'
                  ? '#c04c3d'
                  : undefined;

            const inputText =
              describeToolInput(
                activity.args ?? {},
              );

            const resultText =
              activity.result?.trim() ||
              '';

            /*
             * Live progress streamed by the extension while the command
             * ran. Kept on the card after completion so the user can
             * still see everything the extension did.
             */
            const streamLog =
              activity.streamLog?.trim() ||
              '';

            return (
              <motion.div
                key={activity.id}
                className="tool-activity-card"
                initial={{
                  opacity: 0,
                  y: 6,
                  scale: 0.98,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                  scale: 1,
                }}
                exit={{
                  opacity: 0,
                  scale: 0.96,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 320,
                  damping: 26,
                }}
              >
                <button
                  type="button"
                  className="tool-activity-card__header"
                  onClick={() =>
                    toggleOpen(
                      activity.id,
                    )
                  }
                  aria-expanded={isOpen}
                  aria-label={`${getToolLabel(
                    activity.tool,
                  )} ${isOpen ? '— hide details' : '— show details'}`}
                >
                  <span
                    className={`tool-activity-card__status tool-activity-card__status--${activity.status}`}
                    style={
                      accent
                        ? ({ color: accent } as const)
                        : undefined
                    }
                  >
                    {isRunning ? (
                      <span className="tool-activity-card__spinner" />
                    ) : activity.status ===
                      'error' ? (
                      <ErrorIcon />
                    ) : (
                      <CheckIcon />
                    )}
                  </span>

                  <span className="tool-activity-card__label">
                    {isStreaming
                      ? `${getToolLabel(
                          activity.tool,
                        )} (streaming)`
                      : getToolLabel(
                          activity.tool,
                        )}
                  </span>

                  {!isRunning &&
                  inputText ? (
                    <span className="tool-activity-card__preview">
                      {truncate(
                        inputText,
                        60,
                      )}
                    </span>
                  ) : null}

                  <span
                    className={`tool-activity-card__chevron${
                      isOpen
                        ? ' tool-activity-card__chevron--open'
                        : ''
                    }`}
                    aria-hidden="true"
                  >
                    <ChevronIcon />
                  </span>
                </button>

                {isOpen ? (
                  <div className="tool-activity-card__body">
                    {inputText ? (
                      <>
                        <div className="tool-activity-card__section-title">
                          Input
                        </div>

                        <pre className="tool-activity-card__code">
                          {inputText}
                        </pre>
                      </>
                    ) : null}

                    <div className="tool-activity-card__section-title">
                      {isRunning ? (
                        isStreaming ? (
                          <>
                            <span
                              className="tool-activity-card__spinner"
                              aria-hidden="true"
                            />
                            {' Live output'}
                          </>
                        ) : (
                          'Status'
                        )
                      ) : streamLog ? (
                        'Stream log'
                      ) : (
                        'Output'
                      )}
                    </div>

                    <pre
                      className="tool-activity-card__code tool-activity-card__code--output"
                    >
                      {isRunning
                        ? (isStreaming
                            ? streamLog
                            : resultText)
                          ? `${
                              isStreaming
                                ? streamLog
                                : resultText
                            }\n\n${
                              isStreaming
                                ? '… still streaming …'
                                : '… still running …'
                            }`
                          : 'Running…'
                        : resultText ||
                          'Done — no output.'}
                    </pre>

                    {!isRunning &&
                    streamLog ? (
                      <>
                        <div className="tool-activity-card__section-title">
                          Streamed progress
                        </div>

                        <pre
                          className="tool-activity-card__code tool-activity-card__code--output"
                        >
                          {streamLog}
                        </pre>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </motion.div>
            );
          },
        )}
      </AnimatePresence>
    </div>
  );
}
