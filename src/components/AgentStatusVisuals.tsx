// src/components/AgentStatusVisuals.tsx
//
// Shared visual pieces used by both the floating widget status bubble
// (StatusBubble) and the in-chat status indicator (ChatStatusBubble).
// Keeping the accent colors and the per-state animated icons in one place
// guarantees the widget and the chat always show the same agent activity.

import { motion } from 'framer-motion';

// Dynamic accent color mapping for each tool/state.
// This drives the glow, the ring border, and gives each tool its own identity.
const ACCENT_COLORS: Record<string, string> = {
  listening: '#f87171',
  thinking: '#e2e8f0',
  speaking: '#34d399',
  perplexity_search: '#22d3ee',
  execute_research_pipeline: '#818cf8',
  memory_action: '#c084fc',
  terminal_intent_executor: '#fbbf24',
  desktop_vision_action: '#60a5fa',
  schedule_action: '#fb923c',
  generate_personalized_prompt: '#f472b6',
  happy: '#4ade80',
};

export const getStatusAccent = (state: string): string =>
  ACCENT_COLORS[state] || '#94a3b8';

// Renders a beautiful custom animated SVG icon for each state/tool.
export const AgentStatusIcon: React.FC<{ state: string }> = ({ state }) => {
  switch (state) {
    case 'listening':
      return (
        <motion.svg
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
          className="w-5 h-5 text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
          />
        </motion.svg>
      );

    case 'thinking':
      return (
        <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      );

    case 'speaking':
      return (
        <div className="flex items-end gap-[3px] h-5 w-5 justify-center">
          {[1, 2, 3, 4].map((bar) => (
            <motion.div
              key={bar}
              className="w-[3px] bg-emerald-400 rounded-full"
              animate={{ height: ['20%', '100%', '20%'] }}
              transition={{
                repeat: Infinity,
                duration: 0.6,
                delay: bar * 0.15,
                ease: 'easeInOut',
              }}
            />
          ))}
        </div>
      );

    case 'perplexity_search':
      return (
        <div className="relative w-5 h-5 flex items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: 'linear' }}
            className="absolute inset-0 border-2 border-dashed border-cyan-400/40 rounded-full"
          />
          <svg
            className="w-4 h-4 text-cyan-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      );

    case 'execute_research_pipeline':
      return (
        <div className="relative w-5 h-5 flex items-center justify-center">
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
            className="absolute inset-0 border-[1.5px] border-t-indigo-400 border-r-indigo-400/30 border-b-indigo-400/10 border-l-indigo-400/30 rounded-full"
          />
          <motion.div
            animate={{ scale: [0.6, 1, 0.6], opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            className="w-2 h-2 bg-indigo-400 rounded-full"
          />
        </div>
      );

    case 'memory_action':
      return (
        <motion.svg
          animate={{ scale: [0.9, 1.1, 0.9], opacity: [0.7, 1, 0.7] }}
          transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
          className="w-5 h-5 text-purple-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </motion.svg>
      );

    case 'terminal_intent_executor':
      return (
        <div className="flex items-center text-amber-400 font-mono text-sm font-bold">
          <span>&gt;</span>
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
            className="ml-0.5 w-1.5 h-3.5 bg-amber-400"
          />
        </div>
      );

    case 'desktop_vision_action':
      return (
        <div className="relative w-5 h-5 flex items-center justify-center overflow-hidden">
          <svg
            className="w-5 h-5 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <motion.div
            animate={{ y: [-8, 8, -8] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
            className="absolute left-0 right-0 h-[1.5px] bg-blue-300/80"
          />
        </div>
      );

    case 'schedule_action':
      return (
        <div className="relative w-5 h-5 flex items-center justify-center">
          <svg
            className="w-5 h-5 text-orange-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="9" />
          </svg>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 6, ease: 'linear' }}
            className="absolute w-[1.5px] h-1.5 bg-orange-400 origin-bottom -translate-y-[3px]"
          />
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}
            className="absolute w-[1px] h-2 bg-orange-400 origin-bottom -translate-y-1"
          />
        </div>
      );

    case 'generate_personalized_prompt':
      return (
        <motion.svg
          animate={{ rotate: [0, 15, -15, 0], scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
          className="w-5 h-5 text-pink-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </motion.svg>
      );

    case 'happy':
      return (
        <motion.svg
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.2, 1] }}
          className="w-5 h-5 text-green-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </motion.svg>
      );

    default:
      return null;
  }
};