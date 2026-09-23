// src/chat/components/StepWorkflowPanel.tsx

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  cancelStepWorkflow,
  getStepWorkflowLogEntry,
  getStepWorkflowLogs,
  getStepWorkflowOverview,
  type StepWorkflowLogPage,
  type StepWorkflowOverview,
} from '../../services/ai/stepbystep/workflowManager';

import './StepWorkflowPanel.css';

type LogEntryView = StepWorkflowLogPage['entries'][number];
type LogFilter = 'all' | 'chat' | 'tools';

/** Backend pages are capped at 50 entries each. */
const PAGE_SIZE = 50;
/** Hard cap so a very long workflow cannot freeze the UI. */
const MAX_PAGES = 8;

const EXPANDED_KEY = 'mocu.stepWorkflow.expanded';

const KIND_LABELS: Record<string, string> = {
  user: 'You',
  assistant: 'Mocu',
  tool_call: 'Tool',
  tool_result: 'Result',
  summary: 'Summary',
  transition: 'Step',
  error: 'Error',
};

const FILTERS: Array<{ id: LogFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'tools', label: 'Tools' },
];

function matchesFilter(kind: string, filter: LogFilter): boolean {
  if (filter === 'chat') {
    return kind === 'user' || kind === 'assistant';
  }

  if (filter === 'tools') {
    return kind !== 'user' && kind !== 'assistant';
  }

  return true;
}

interface OpenEntry {
  text: string;
  /** Offset to pass to fetch the next chunk, or null when complete. */
  more: number | null;
}

interface StepWorkflowPanelProps {
  chatId: string | null;
  /** Changes whenever the conversation gains a message, so the panel refreshes. */
  refreshKey: number;
  /** Reports whether a workflow is active, so the dock can collapse. */
  onActiveChange?: (active: boolean) => void;
}

/**
 * Step-by-step workflow card.
 *
 * Rendered inside the RightPanelDock while a step-by-step workflow is
 * active. Shows the plan (done / current / pending steps), the current
 * step details and a complete chronological log. The card can be
 * collapsed to a slim header row.
 */
export function StepWorkflowPanel({
  chatId,
  refreshKey,
  onActiveChange,
}: StepWorkflowPanelProps) {
  const [overview, setOverview] = useState<StepWorkflowOverview | null>(null);
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(EXPANDED_KEY) !== '0',
  );
  const [logs, setLogs] = useState<LogEntryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [openEntries, setOpenEntries] = useState<Record<string, OpenEntry>>(
    {},
  );
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  /* ---------------- overview ---------------- */

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!chatId) {
        setOverview(null);

        return;
      }

      try {
        const result = await getStepWorkflowOverview(chatId);

        if (!cancelled) {
          setOverview(result);
        }
      } catch {
        if (!cancelled) {
          setOverview(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [chatId, refreshKey]);

  /* Notify the parent when a workflow becomes active or inactive, so the
   * right dock can collapse when there is nothing to show. */
  useEffect(() => {
    onActiveChange?.(overview !== null);
  }, [overview, onActiveChange]);

  /* ---------------- logs ---------------- */

  /**
   * Fetch every log page (oldest → newest) so the feed always shows the
   * latest conversation. One backend call already reads all files, so
   * walking the pages is cheap and keeps the feed correct.
   */
  useEffect(() => {
    if (!chatId || !overview || !expanded) {
      setLogs([]);

      return;
    }

    let cancelled = false;

    setLoading(true);

    void (async () => {
      try {
        const all: LogEntryView[] = [];
        let offset = 0;

        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await getStepWorkflowLogs(
            chatId,
            null,
            offset,
            PAGE_SIZE,
          );

          all.push(...result.entries);

          if (result.nextOffset === null) {
            break;
          }

          offset = result.nextOffset;
        }

        if (!cancelled) {
          setLogs(all);
        }
      } catch {
        // Keep whatever was loaded before.
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, overview, expanded, refreshKey]);

  /* auto-scroll to the newest entry while the user is near the bottom */
  useEffect(() => {
    const node = logScrollRef.current;

    if (node && stickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [logs, expanded]);

  const handleLogScroll = useCallback(() => {
    const node = logScrollRef.current;

    if (!node) {
      return;
    }

    stickToBottomRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }, []);

  /* ---------------- entry expand ---------------- */

  const toggleEntry = useCallback(
    async (entry: LogEntryView) => {
      if (!chatId) {
        return;
      }

      setOpenEntries((current) => {
        if (current[entry.id]) {
          const next = { ...current };

          delete next[entry.id];

          return next;
        }

        return {
          ...current,
          [entry.id]: { text: 'Loading…', more: null },
        };
      });

      if (openEntries[entry.id]) {
        return;
      }

      try {
        const result = await getStepWorkflowLogEntry(
          chatId,
          entry.id,
          0,
          8000,
        );

        setOpenEntries((current) => ({
          ...current,
          [entry.id]: { text: result.text, more: result.nextOffset },
        }));
      } catch {
        setOpenEntries((current) => ({
          ...current,
          [entry.id]: {
            text: 'The log entry could not be read.',
            more: null,
          },
        }));
      }
    },
    [chatId, openEntries],
  );

  const loadMoreOfEntry = useCallback(
    async (entry: LogEntryView) => {
      const open = openEntries[entry.id];

      if (!chatId || !open || open.more === null) {
        return;
      }

      try {
        const result = await getStepWorkflowLogEntry(
          chatId,
          entry.id,
          open.more,
          8000,
        );

        setOpenEntries((current) => ({
          ...current,
          [entry.id]: {
            text: `${current[entry.id]?.text ?? ''}\n${result.text}`,
            more: result.nextOffset,
          },
        }));
      } catch {
        setOpenEntries((current) => ({
          ...current,
          [entry.id]: { ...open, more: null },
        }));
      }
    },
    [chatId, openEntries],
  );

  /* ---------------- actions ---------------- */

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      const next = !current;

      localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      stickToBottomRef.current = true;

      return next;
    });
  }, []);

  const handleCancel = useCallback(async () => {
    if (!chatId || !overview) {
      return;
    }

    if (!window.confirm('Cancel this step-by-step workflow?')) {
      return;
    }

    try {
      await cancelStepWorkflow(chatId);
      setOverview(null);
      setLogs([]);
    } catch {
      // Cancellation failures are logged by the manager.
    }
  }, [chatId, overview]);

  if (!overview) {
    return null;
  }

  const visibleLogs = logs.filter((entry) =>
    matchesFilter(entry.kind, filter),
  );
  const doneCount = overview.steps.filter(
    (step) => step.state === 'done',
  ).length;
  const progress = Math.round((doneCount / overview.totalSteps) * 100);
  const currentStep =
    overview.steps[overview.currentStepNumber - 1];

  return (
    <section
      className={`step-workflow-panel${
        expanded ? ' step-workflow-panel--open' : ''
      }`}
      aria-label="Step-by-step workflow"
    >
      <button
        type="button"
        className="step-workflow-panel__header"
        onClick={toggleExpanded}
        title={expanded ? 'Hide details' : 'Show details'}
      >
        <span className="step-workflow-panel__pulse" aria-hidden="true" />

        <span className="step-workflow-panel__heading">
          <span className="step-workflow-panel__title">
            Step by Step
          </span>

          <span className="step-workflow-panel__meta">
            Step {overview.currentStepNumber} of {overview.totalSteps}
            {!expanded && currentStep ? ` · ${currentStep.title}` : ''}
          </span>
        </span>

        <span className="step-workflow-panel__progress-pill">
          {doneCount}/{overview.totalSteps}
        </span>

        <span
          className={`step-workflow-panel__chevron${
            expanded ? ' step-workflow-panel__chevron--open' : ''
          }`}
          aria-hidden="true"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 6l5 5 5-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {expanded ? (
        <div className="step-workflow-panel__body">
          <div className="step-workflow-panel__progress-track">
            <div
              className="step-workflow-panel__progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="step-workflow-panel__goal" title={overview.finalGoal}>
            {overview.finalGoal}
          </p>

          {/* -------- plan timeline -------- */}

          <ol className="step-workflow-panel__steps">
            {overview.steps.map((step) => {
              const isCurrent = step.state === 'current';

              return (
                <li
                  key={step.stepNumber}
                  className={`step-workflow-panel__step step-workflow-panel__step--${step.state}`}
                >
                  <span className="step-workflow-panel__step-marker">
                    {step.state === 'done' ? (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M3 8.5l3.5 3.5L13 5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      step.stepNumber
                    )}
                  </span>

                  <div className="step-workflow-panel__step-body">
                    <span className="step-workflow-panel__step-title">
                      {step.title}
                    </span>

                    {isCurrent && step.goal ? (
                      <span className="step-workflow-panel__step-detail">
                        {step.goal}
                      </span>
                    ) : null}

                    {isCurrent && step.tips.length > 0 ? (
                      <ul className="step-workflow-panel__step-tips">
                        {step.tips.slice(0, 2).map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                    ) : null}

                    {!isCurrent && step.summary ? (
                      <span
                        className="step-workflow-panel__step-detail step-workflow-panel__step-detail--dim"
                        title={step.summary}
                      >
                        {step.summary}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* -------- log feed -------- */}

          <div className="step-workflow-panel__log-toolbar">
            <span className="step-workflow-panel__log-label">Log</span>

            <div
              className="step-workflow-panel__filters"
              role="tablist"
              aria-label="Log filter"
            >
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.id}
                  className={`step-workflow-panel__filter${
                    filter === item.id
                      ? ' step-workflow-panel__filter--active'
                      : ''
                  }`}
                  onClick={() => {
                    setFilter(item.id);
                    stickToBottomRef.current = true;
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="step-workflow-panel__logs"
            ref={logScrollRef}
            onScroll={handleLogScroll}
          >
            {visibleLogs.map((entry) => {
              const open = openEntries[entry.id];

              return (
                <div
                  key={entry.id}
                  className={`step-workflow-log-entry step-workflow-log-entry--${entry.kind}`}
                >
                  <button
                    type="button"
                    className="step-workflow-log-entry__summary"
                    onClick={() => {
                      void toggleEntry(entry);
                    }}
                  >
                    <span
                      className={`step-workflow-log-entry__kind step-workflow-log-entry__kind--${entry.kind}`}
                    >
                      {KIND_LABELS[entry.kind] ?? entry.kind}
                    </span>

                    <span className="step-workflow-log-entry__preview">
                      {logPreview(entry)}
                    </span>

                    <span className="step-workflow-log-entry__time">
                      {formatTime(entry.time)}
                    </span>
                  </button>

                  {open ? (
                    <div className="step-workflow-log-entry__detail">
                      <pre>{open.text}</pre>

                      {open.more !== null ? (
                        <button
                          type="button"
                          className="step-workflow-log-entry__more"
                          onClick={() => {
                            void loadMoreOfEntry(entry);
                          }}
                        >
                          Show more…
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {visibleLogs.length === 0 && !loading ? (
              <p className="step-workflow-panel__empty">
                No log entries yet.
              </p>
            ) : null}

            {loading ? (
              <p className="step-workflow-panel__loading">
                Loading log…
              </p>
            ) : null}
          </div>

          <div className="step-workflow-panel__footer">
            <span className="step-workflow-panel__count">
              {logs.length} entries
            </span>

            <button
              type="button"
              className="step-workflow-panel__cancel"
              onClick={() => {
                void handleCancel();
              }}
            >
              Cancel workflow
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function logPreview(entry: LogEntryView): string {
  const text = entry.preview;

  try {
    const value = JSON.parse(text) as Record<string, unknown>;

    if (entry.kind === 'user' && typeof value.message === 'string') {
      return value.message;
    }

    if (entry.kind === 'assistant' && typeof value.reply === 'string') {
      return value.reply;
    }

    if (entry.kind === 'tool_call' && typeof value.name === 'string') {
      return `Using ${value.name}`;
    }

    if (entry.kind === 'tool_result' && typeof value.name === 'string') {
      return `${value.name} completed`;
    }

    if (entry.kind === 'transition' && typeof value.action === 'string') {
      return value.action.replace(/_/g, ' ');
    }
  } catch {
    // Keep the raw preview for old or non-JSON log entries.
  }

  return firstLine(text);
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? '';

  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

function formatTime(time: string): string {
  const date = new Date(time);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}
