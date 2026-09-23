// src/chat/components/RightPanelDock.tsx

import type { ReactNode } from 'react';

import './RightPanelDock.css';

interface RightPanelDockProps {
  children: ReactNode;
  /** When true (no active cards), the dock collapses to zero width. */
  hidden?: boolean;
}

/**
 * Right-side dock of the chat page.
 *
 * Every auxiliary card (step-by-step workflow, future tools panel,
 * memory panel, …) is stacked here as a child. Cards manage their own
 * collapsed / expanded state, the dock only handles layout and scrolling.
 *
 * While no card has content (`hidden`), the dock takes no space so the
 * chat is not left with a large empty area on the right.
 */
export function RightPanelDock({ children, hidden }: RightPanelDockProps) {
  return (
    <aside
      className={`right-panel-dock${
        hidden ? ' right-panel-dock--hidden' : ''
      }`}
    >
      {children}
    </aside>
  );
}
