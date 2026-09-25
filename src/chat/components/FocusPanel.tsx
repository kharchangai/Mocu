import { useCallback, useEffect, useState } from 'react';

import {
  cancelFocusSession,
  getFocusOverview,
  type FocusOverview,
} from '../../services/ai/focus/focusManager';

import './FocusPanel.css';

interface FocusPanelProps {
  chatId: string | null;
  refreshKey: number;
  onActiveChange?: (active: boolean) => void;
}

export function FocusPanel({ chatId, refreshKey, onActiveChange }: FocusPanelProps) {
  const [overview, setOverview] = useState<FocusOverview | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!chatId) {
        setOverview(null);
        return;
      }
      try {
        const result = await getFocusOverview(chatId);
        if (!cancelled) {
          setOverview(result);
        }
      } catch {
        if (!cancelled) setOverview(null);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [chatId, refreshKey]);

  useEffect(() => {
    onActiveChange?.(overview?.status === 'active');
  }, [overview, onActiveChange]);

  const endFocus = useCallback(async () => {
    if (!chatId || !overview || overview.status !== 'active') return;
    if (!window.confirm('End Focus and return to normal chat?')) return;
    try {
      await cancelFocusSession(chatId);
      setOverview((current) => current ? { ...current, status: 'completed' } : current);
    } catch {
      // Errors are surfaced by the session manager when the current turn is busy.
    }
  }, [chatId, overview]);

  if (!overview) return null;
  return (
    <section className={`focus-panel${expanded ? ' focus-panel--expanded' : ''}`} aria-label="Focus session">
      <button className="focus-panel__header" type="button" onClick={() => setExpanded((value) => !value)}>
        <span className="focus-panel__dot" aria-hidden="true" />
        <span className="focus-panel__heading">
          <strong>Focus</strong>
          <span>{overview.status === 'active' ? `Section ${overview.currentSectionNumber}` : 'Session ended'}</span>
        </span>
        <span className="focus-panel__chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
      </button>
      {expanded ? (
        <div className="focus-panel__body">
          <p className="focus-panel__goal" title={overview.goal}>{overview.goal}</p>
          <div className="focus-panel__sections" aria-label="Focus sections">
            <span className="focus-panel__eyebrow">SECTIONS</span>
            <ol>
              {overview.sections.map((section) => (
                <li
                  key={section.sectionNumber}
                  className={`focus-panel__section${section.isCurrent ? ' focus-panel__section--current' : ''}`}
                >
                  <span className="focus-panel__section-marker" aria-hidden="true">
                    {section.memory ? '✓' : section.sectionNumber}
                  </span>
                  <div className="focus-panel__section-content">
                    <strong>
                      Section {section.sectionNumber}
                      {section.isCurrent ? ' · in progress' : ''}
                    </strong>
                    {section.memory?.summary ? <p>{section.memory.summary}</p> : null}
                    {section.memory?.artifacts.length ? (
                      <ul className="focus-panel__artifacts">
                        {section.memory.artifacts.map((artifact) => <li key={artifact}>{artifact}</li>)}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          {overview.status === 'active' ? (
            <button className="focus-panel__end" type="button" onClick={() => void endFocus()}>End Focus</button>
          ) : <span className="focus-panel__ended">You are back in normal chat.</span>}
        </div>
      ) : null}
    </section>
  );
}
