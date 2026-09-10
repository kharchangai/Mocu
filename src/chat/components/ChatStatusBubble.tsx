// src/chat/components/ChatStatusBubble.tsx
//
// In-chat companion to the floating StatusBubble.
// While the agent is processing a request it shows the same animated,
// color-coded status capsule next to a human-readable label, so the
// user always knows what the agent is doing (thinking, searching the
// web, running a terminal command, ...).
//
// It listens to the same "mocu_activity" custom events that the
// widget bubble listens to, so both stay in sync automatically.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import {
  AgentStatusIcon,
  getStatusAccent,
} from '../../components/AgentStatusVisuals';

// Friendly, human-readable label per status/tool.
const STATUS_LABELS: Record<string, string> = {
  listening: 'Listening…',
  speaking: 'Speaking…',
  perplexity_search: 'Searching the web…',
  execute_research_pipeline: 'Running a research pipeline…',
  memory_action: 'Accessing long-term memory…',
  terminal_executor: 'Running a terminal command…',
  desktop_vision_action: 'Looking at your screen…',
  schedule_action: 'Checking the schedule…',
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

  const status = activeActivity || 'thinking';
  const accent = getStatusAccent(status);

  const label =
    status === 'thinking'
      ? `${agentName} is thinking…`
      : STATUS_LABELS[status] ?? `${prettifyStatus(status)}…`;

  return (
    <div
      className="chat-status-bubble"
      role="status"
      aria-label={label}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={status}
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          className="chat-status-bubble-body"
        >
          {/* Progress capsule, visually identical to the widget bubble */}
          <div className="chat-status-bubble-capsule">
            {/* Rotating conic gradient acting as a living border */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 3.5, ease: 'linear' }}
              style={{
                background: `conic-gradient(from 0deg, transparent 0%, ${accent} 30%, transparent 55%)`,
              }}
            />

            {/* Inner frosted glass body */}
            <div className="chat-status-bubble-glass">
              <div className="relative z-10">
                <AgentStatusIcon state={status} />
              </div>
            </div>
          </div>

          <span className="chat-status-bubble-label">{label}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}