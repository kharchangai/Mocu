// src/chat/components/MemorySaveIndicator.tsx
//
// Small mind (brain) icon shown directly below the agent's latest
// response.
//
// While the background project-memory save is running the icon blinks
// softly; once the save completes it stops blinking and rests in a
// calm "saved" state. On failure it shows a muted error color.
//
// The component is presentational: the status comes from the
// useMemorySaveStatus hook in ChatBox, which is always mounted and
// therefore never misses the "saving" event.

import type { MemorySaveStatus } from '../services/memoryActivity';

import './MemorySaveIndicator.css';

function MindIcon() {
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
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M12 5v13" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </svg>
  );
}

const STATUS_LABELS: Record<
  MemorySaveStatus,
  string
> = {
  saving: 'Saving to memory…',
  done: 'Memory saved',
  error: 'Memory save failed',
};

type MemorySaveIndicatorProps = {
  status: MemorySaveStatus | null;
};

export function MemorySaveIndicator({
  status,
}: MemorySaveIndicatorProps) {
  if (!status) {
    return null;
  }

  return (
    <div
      className={`memory-save-indicator memory-save-indicator--${status}`}
      role="status"
      aria-label={
        STATUS_LABELS[status]
      }
      title={STATUS_LABELS[status]}
    >
      <span className="memory-save-indicator__icon">
        <MindIcon />
      </span>
    </div>
  );
}
