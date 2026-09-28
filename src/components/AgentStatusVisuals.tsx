// src/components/AgentStatusVisuals.tsx
//
// Shared visual pieces for the Mocu avatar bubble (StatusBubble).
// Keeping the accent colors and the per-tool icons in one place.
//
// EVERY tool the Mocu avatar can use (see src/services/ai/nodes.ts and
// the planning / focus tools) has its OWN icon here. When the avatar
// runs a tool, the bubble above it shows that tool's icon so the user
// always sees which tool is being used.

import { motion } from 'framer-motion';

type IconProps = { className?: string };

/*
 * Shared glyph frame: 24x24 stroke icon with a gentle breathing
 * animation, tinted by the tool's accent color.
 */
const Glyph = ({
  color,
  children,
}: IconProps & { color: string; children: React.ReactNode }) => (
  <motion.svg
    animate={{ scale: [0.95, 1.06, 0.95] }}
    transition={{ repeat: Infinity, duration: 1.9, ease: 'easeInOut' }}
    className="w-5 h-5"
    style={{ color }}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </motion.svg>
);

/* -------------------------------------------------------------- */
/* Mocu avatar tools (src/services/ai/nodes.ts) — one icon each.   */
/* -------------------------------------------------------------- */

const ScheduleActionIcon = () => (
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

const DesktopVisionIcon = () => (
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

const TerminalExecutorIcon = () => (
  <div className="flex items-center text-amber-400 font-mono text-sm font-bold">
    <span>&gt;</span>
    <motion.span
      animate={{ opacity: [1, 0, 1] }}
      transition={{ repeat: Infinity, duration: 0.8, ease: 'linear' }}
      className="ml-0.5 w-1.5 h-3.5 bg-amber-400"
    />
  </div>
);

const PerplexitySearchIcon = () => (
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

const TextToSpeechIcon = () => (
  <Glyph color="#34d399">
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M15.5 8.5a5 5 0 010 7" />
    <path d="M18.5 5.5a9 9 0 010 13" />
  </Glyph>
);

const SpeechControlIcon = () => (
  <Glyph color="#f43f5e">
    <path d="M11 5L6 9H3v6h3l5 4V5z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Glyph>
);

const SaveNoteIcon = () => (
  <Glyph color="#facc15">
    <path d="M5 4a1 1 0 011-1h12a1 1 0 011 1v16a1 1 0 01-1 1H6a1 1 0 01-1-1V4z" />
    <path d="M9 3v3M15 3v3" />
    <path d="M12 10v6M9 13h6" />
  </Glyph>
);

const ReadNoteIcon = () => (
  <Glyph color="#38bdf8">
    <path d="M12 6c-2-1.5-4.5-2-8-2v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2V4c-3.5 0-6 .5-8 2z" />
    <path d="M12 6v13" />
  </Glyph>
);

const UpdateNoteIcon = () => (
  <Glyph color="#e879f9">
    <path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4L16.5 3.5z" />
    <path d="M14.5 5.5l3 3" />
    <path d="M4 22h16" />
  </Glyph>
);

const DeleteNoteIcon = () => (
  <Glyph color="#f87171">
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" />
    <path d="M10 11v6M14 11v6" />
  </Glyph>
);

const ListNotesIcon = () => (
  <Glyph color="#a3e635">
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M5 6h.01M5 12h.01M5 18h.01" />
  </Glyph>
);

/* -------------------------------------------------------------- */
/* Planning / workflow / focus tools — one icon each.               */
/* -------------------------------------------------------------- */

const UpdatePlanIcon = () => (
  <Glyph color="#a78bfa">
    <path d="M21 12a9 9 0 00-9-9 9.75 9.75 0 00-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 009 9 9.75 9.75 0 006.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </Glyph>
);

const MoveToNextStepIcon = () => (
  <Glyph color="#60a5fa">
    <path d="M3 12h12M12 7l5 5-5 5M20 5v14" />
  </Glyph>
);

const FinishWorkflowIcon = () => (
  <Glyph color="#4ade80">
    <path d="M6 21V4" />
    <path d="M6 5c4-2 8 2 12 0v8c-4 2-8-2-12 0" />
  </Glyph>
);

const ReadStepLogsIcon = () => (
  <Glyph color="#22d3ee">
    <rect x="4" y="5" width="16" height="14" rx="1" />
    <path d="M4 9h16M9 9v10" />
  </Glyph>
);

const ReadLogEntryIcon = () => (
  <Glyph color="#fbbf24">
    <path d="M7 3h7l4 4v14H7z" />
    <path d="M14 3v4h4" />
    <path d="M10 12h5M10 16h3" />
  </Glyph>
);

const ReadStepMemoryIcon = () => (
  <Glyph color="#c084fc">
    <rect x="9" y="9" width="6" height="6" rx="1" />
    <path d="M4 10h4M4 14h4M16 10h4M16 14h4M10 4v4M14 4v4M10 16v4M14 16v4" />
  </Glyph>
);

const ReadFocusSectionMemoryIcon = () => (
  <Glyph color="#f472b6">
    <path d="M7 3h10a1 1 0 011 1v17l-6-4-6 4V4a1 1 0 011-1z" />
  </Glyph>
);

const ReadFocusSectionHistoryIcon = () => (
  <Glyph color="#fb923c">
    <path d="M11 5L4 12l7 7M20 5l-7 7 7 7" />
  </Glyph>
);

const ReadFocusHistoryEntryIcon = () => (
  <Glyph color="#fcd34d">
    <path d="M7 3h10M7 21h10" />
    <path d="M8 3c0 5 8 5 8 9s-8 4-8 9" />
    <path d="M16 3c0 5-8 5-8 9s8 4 8 9" />
  </Glyph>
);

const RecordFocusMilestoneIcon = () => (
  <Glyph color="#f59e0b">
    <circle cx="12" cy="9" r="6" />
    <path d="M8.5 14L7 22l5-3 5 3-1.5-8" />
  </Glyph>
);

const NextFocusSectionIcon = () => (
  <Glyph color="#818cf8">
    <path d="M6 5l6 7-6 7M13 5l6 7-6 7" />
  </Glyph>
);

const EndFocusIcon = () => (
  <Glyph color="#f87171">
    <circle cx="12" cy="12" r="9" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </Glyph>
);

/* -------------------------------------------------------------- */
/* Older avatar states kept for compatibility.                      */
/* -------------------------------------------------------------- */

const MemoryActionIcon = () => (
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

const ExecuteResearchPipelineIcon = () => (
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

const GeneratePersonalizedPromptIcon = () => (
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

/* Fallback: any unknown tool still gets a real icon (never empty). */
const GenericToolIcon = () => (
  <motion.svg
    animate={{ rotate: [0, -14, 14, 0], scale: [0.95, 1.08, 0.95] }}
    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
    className="w-5 h-5 text-slate-300"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
    />
  </motion.svg>
);

/* -------------------------------------------------------------- */
/* One icon per tool/state name.                                    */
/* -------------------------------------------------------------- */

export const AVATAR_TOOL_ICONS: Record<string, React.FC> = {
  // Mocu avatar tools (nodes.ts)
  schedule_action: ScheduleActionIcon,
  desktop_vision_action: DesktopVisionIcon,
  terminal_executor: TerminalExecutorIcon,
  perplexity_search: PerplexitySearchIcon,
  text_to_speech: TextToSpeechIcon,
  speech_control: SpeechControlIcon,
  save_note: SaveNoteIcon,
  read_note: ReadNoteIcon,
  update_note: UpdateNoteIcon,
  delete_note: DeleteNoteIcon,
  list_notes: ListNotesIcon,
  // Planning / workflow / focus tools
  update_plan: UpdatePlanIcon,
  move_to_next_step: MoveToNextStepIcon,
  finish_workflow: FinishWorkflowIcon,
  read_step_logs: ReadStepLogsIcon,
  read_log_entry: ReadLogEntryIcon,
  read_step_memory: ReadStepMemoryIcon,
  read_focus_section_memory: ReadFocusSectionMemoryIcon,
  read_focus_section_history: ReadFocusSectionHistoryIcon,
  read_focus_history_entry: ReadFocusHistoryEntryIcon,
  record_focus_milestone: RecordFocusMilestoneIcon,
  next_focus_section: NextFocusSectionIcon,
  end_focus: EndFocusIcon,
  // Older avatar states
  memory_action: MemoryActionIcon,
  execute_research_pipeline: ExecuteResearchPipelineIcon,
  generate_personalized_prompt: GeneratePersonalizedPromptIcon,
};

// Dynamic accent color per tool (glow + ring around the bubble).
const ACCENT_COLORS: Record<string, string> = {
  listening: '#f87171',
  thinking: '#e2e8f0',
  speaking: '#34d399',
  happy: '#4ade80',
  schedule_action: '#fb923c',
  desktop_vision_action: '#60a5fa',
  terminal_executor: '#fbbf24',
  perplexity_search: '#22d3ee',
  text_to_speech: '#34d399',
  speech_control: '#f43f5e',
  save_note: '#facc15',
  read_note: '#38bdf8',
  update_note: '#e879f9',
  delete_note: '#f87171',
  list_notes: '#a3e635',
  update_plan: '#a78bfa',
  move_to_next_step: '#60a5fa',
  finish_workflow: '#4ade80',
  read_step_logs: '#22d3ee',
  read_log_entry: '#fbbf24',
  read_step_memory: '#c084fc',
  read_focus_section_memory: '#f472b6',
  read_focus_section_history: '#fb923c',
  read_focus_history_entry: '#fcd34d',
  record_focus_milestone: '#f59e0b',
  next_focus_section: '#818cf8',
  end_focus: '#f87171',
  memory_action: '#c084fc',
  execute_research_pipeline: '#818cf8',
  generate_personalized_prompt: '#f472b6',
  generic_tool: '#94a3b8',
};

export const getStatusAccent = (state: string): string =>
  ACCENT_COLORS[state] || ACCENT_COLORS.generic_tool;

// Renders the icon of the tool the avatar is running right now.
export const AgentStatusIcon: React.FC<{ state: string }> = ({ state }) => {
  const ToolIcon = AVATAR_TOOL_ICONS[state];

  if (ToolIcon) {
    return <ToolIcon />;
  }

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
      return <GenericToolIcon />;
  }
};
