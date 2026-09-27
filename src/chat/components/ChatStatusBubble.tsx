// src/chat/components/ChatStatusBubble.tsx
//
// In-chat status line shown while the agent works.
//
// Deliberately minimal — black & white, one line: a small pulsing dot
// and the current activity ("Thinking…", "Running a terminal
// command…"). It listens to the same "mocu_activity" custom events as
// the floating avatar bubble, so both stay in sync automatically.

import { useEffect, useState } from 'react';

// Friendly, human-readable label per status/tool.
const STATUS_LABELS: Record<string, string> = {
  listening: 'Listening…',
  speaking: 'Speaking…',
  perplexity_search: 'Searching the web…',
  execute_research_pipeline: 'Running a research pipeline…',
  memory_action: 'Accessing long-term memory…',
  terminal_executor: 'Running a terminal command…',
  desktop_vision_action: 'Looking at your screen…',
  schedule_action: 'Managing the schedule…',
  generate_personalized_prompt: 'Crafting a personalized prompt…',
  happy: 'Done!',
};

const prettifyStatus = (status: string): string =>
  status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

type ChatStatusBubbleProps = {
  agentName?: string;
  isLoading: boolean;
};

export function ChatStatusBubble({
  agentName = 'Mocu',
  isLoading,
}: ChatStatusBubbleProps) {
  const [activeActivity, setActiveActivity] = useState<string | null>(null);

  useEffect(() => {
    const handleActivity = (event: Event) => {
      const customEvent = event as CustomEvent<string | null>;
      setActiveActivity(customEvent.detail);
    };

    window.addEventListener('mocu_activity', handleActivity);
    return () => {
      window.removeEventListener('mocu_activity', handleActivity);
    };
  }, []);

  // Clear a stale tool name as soon as the agent is no longer loading,
  // so it never bleeds into the next request.
  useEffect(() => {
    if (!isLoading) {
      setActiveActivity(null);
    }
  }, [isLoading]);

  if (!isLoading) {
    return null;
  }

  const label = activeActivity
    ? STATUS_LABELS[activeActivity] ?? `${prettifyStatus(activeActivity)}…`
    : `${agentName} is thinking…`;

  return (
    <div
      className="chat-status-line"
      role="status"
      aria-label={label}
    >
      <span
        className="chat-status-line__dot"
        aria-hidden="true"
      />
      <span className="chat-status-line__label">{label}</span>
    </div>
  );
}