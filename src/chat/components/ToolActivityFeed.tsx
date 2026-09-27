// src/chat/components/ToolActivityFeed.tsx
//
// The agent trace shown inside the chat: what the agent thought and
// which tools it ran, in order, while it works.
//
// Kept intentionally minimal (black & white, one line per entry):
//
//   ✦ dim italic text      the model's thinking, streamed live
//   ↳ dim text             words the model wrote before running tools
//   ● label  preview   ›  one tool call — click the arrow for its log
//
// The component is presentational: the entries come in as props from
// the useToolActivity hook, so the trace can be shown per message
// (above the agent's response) and stay visible after the answer
// arrives.

import { memo, useState } from 'react';

import type { AgentToolActivity } from '../services/toolActivity';

import './ToolActivityFeed.css';

/*
 * Short, neutral label per tool — reads the same before and after the
 * call finished. Unknown tools fall back to their prettified name.
 */
const TOOL_LABELS: Record<string, string> = {
  perplexity_search: 'Web search',
  execute_research_pipeline: 'Research pipeline',
  memory_action: 'Long-term memory',
  terminal_executor: 'Terminal command',
  desktop_vision_action: 'Screen look',
  schedule_action: 'Schedule',
  generate_personalized_prompt: 'Personalized prompt',
};

const prettifyToolName = (tool: string): string =>
  tool
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const getToolLabel = (tool: string): string =>
  TOOL_LABELS[tool] ?? prettifyToolName(tool);

/*
 * Best-effort one-line summary of the tool input for the row preview /
 * the expanded "input" block. Well-known keys (command, query, ...) are
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

  if (typeof args.task === 'string' && args.task.trim()) {
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

/*
 * Two kinds of model lines:
 *
 *   ✦ thought — the model's reasoning: streams word by word while the
 *               model works and STAYS fully visible afterwards (like
 *               pi's thinking lines), in dim gray italic.
 *   ↳ note    — ordinary text the model wrote before running tools:
 *               one quiet row with a preview that grows while it
 *               streams; click it to read the complete text.
 *
 * The agent's response is a separate thing and only appears at the
 * very end of the turn.
 */
const TraceTextImpl = ({
  activity,
}: {
  activity: AgentToolActivity;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const text = activity.text?.trim() ?? '';
  const isThought = activity.kind === 'thought';
  const isRunning = activity.status === 'running';

  /*
   * ✦ Model thinking — never collapsed, never hidden: the user must be
   * able to watch the model think and read it all afterwards.
   */
  if (isThought) {
    if (!text && !isRunning) {
      return null;
    }

    return (
      <div
        className={`trace-text trace-text--thought${
          isRunning ? ' trace-text--running' : ''
        }`}
      >
        <span
          className="trace-text__mark"
          aria-hidden="true"
        >
          ✦
        </span>

        <p className="trace-text__content">
          {text || 'Thinking…'}
        </p>
      </div>
    );
  }

  /* ↳ Model words before tools — a row you can click open. */
  if (!text) {
    return null;
  }

  return (
    <div
      className={`trace-text trace-text--note${
        isRunning ? ' trace-text--note-streaming' : ''
      }`}
    >
      <button
        type="button"
        className="trace-text__row"
        onClick={() =>
          setIsOpen((previous) => !previous)
        }
        aria-expanded={isOpen}
        aria-label={
          isOpen
            ? 'Words before tools — hide them'
            : 'Words before tools — show them'
        }
      >
        <span
          className="trace-text__mark"
          aria-hidden="true"
        >
          ↳
        </span>

        <span className="trace-text__preview">
          {truncate(
            text.replace(/\s+/g, ' '),
            110,
          )}
        </span>

        <span
          className={`trace-text__chevron${
            isOpen ? ' trace-text__chevron--open' : ''
          }`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>

      {isOpen ? (
        <p className="trace-text__content trace-text__content--full">
          {text}
        </p>
      ) : null}
    </div>
  );
};

const TraceText = memo(TraceTextImpl);

const TraceToolImpl = ({
  activity,
}: {
  activity: AgentToolActivity;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const isRunning = activity.status === 'running';

  const inputText = describeToolInput(
    activity.args ?? {},
  );

  const resultText = activity.result?.trim() ?? '';
  const streamLog = activity.streamLog?.trim() ?? '';

  const outputText =
    [streamLog, resultText].filter(Boolean).join('\n\n') ||
    (isRunning ? '…' : 'No output.');

  const preview = inputText
    ? truncate(inputText.replace(/\s+/g, ' '), 80)
    : '';

  return (
    <div className="trace-tool">
      <button
        type="button"
        className="trace-tool__row"
        onClick={() => setIsOpen((previous) => !previous)}
        aria-expanded={isOpen}
        aria-label={`${getToolLabel(activity.tool)}${
          isOpen ? ' — hide log' : ' — show log'
        }`}
      >
        <span
          className={`trace-tool__status trace-tool__status--${activity.status}`}
          aria-hidden="true"
        >
          {isRunning ? (
            <span className="trace-tool__spinner" />
          ) : activity.status === 'error' ? (
            '✕'
          ) : activity.status === 'cancelled' ? (
            '–'
          ) : (
            '✓'
          )}
        </span>

        <span className="trace-tool__label">
          {getToolLabel(activity.tool)}
        </span>

        {preview ? (
          <span className="trace-tool__preview">
            {preview}
          </span>
        ) : null}

        <span
          className={`trace-tool__chevron${
            isOpen ? ' trace-tool__chevron--open' : ''
          }`}
          aria-hidden="true"
        >
          ›
        </span>
      </button>

      {isOpen ? (
        <div className="trace-tool__details">
          <div className="trace-tool__meta">
            {activity.tool}
          </div>

          {inputText ? (
            <pre className="trace-tool__pre">
              {inputText}
            </pre>
          ) : null}

          <pre className="trace-tool__pre trace-tool__pre--output">
            {outputText}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

const TraceTool = memo(TraceToolImpl);

type ToolActivityFeedProps = {
  activities: AgentToolActivity[];
};

function ToolActivityFeedImpl({
  activities,
}: ToolActivityFeedProps) {
  if (activities.length === 0) {
    return null;
  }

  return (
    <div
      className="tool-activity-feed"
      aria-label="Agent activity"
    >
      {activities.map((activity) =>
        activity.kind === 'thought' ||
        activity.kind === 'note' ? (
          <TraceText
            key={activity.id}
            activity={activity}
          />
        ) : (
          <TraceTool
            key={activity.id}
            activity={activity}
          />
        ),
      )}
    </div>
  );
}

/*
 * Memoized so typing in the composer does not re-render the trace of
 * finished turns. The activities array is a stable reference from the
 * tool-activity store, so this only re-renders when a turn is actually
 * committed.
 */
export const ToolActivityFeed = memo(ToolActivityFeedImpl);