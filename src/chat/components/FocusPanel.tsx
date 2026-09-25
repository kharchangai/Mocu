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
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

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
    if (!chatId || !overview || overview.status !== 'active' || isEnding) return;
    setIsEnding(true);
    setEndError(null);
    try {
      await cancelFocusSession(chatId);
      setOverview((current) => current ? { ...current, status: 'completed' } : current);
      setConfirmEnd(false);
      window.dispatchEvent(new CustomEvent('mocu_saved_work_changed', { detail: { chatId } }));
    } catch (error) {
      setEndError(error instanceof Error ? error.message : 'Could not end Focus.');
    } finally {
      setIsEnding(false);
    }
  }, [chatId, overview, isEnding]);

  if (!overview || overview.status !== 'active') return null;
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
                    {section.isCurrent ? section.sectionNumber : section.memory ? '✓' : section.sectionNumber}
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
          {confirmEnd ? (
            <div className="focus-panel__confirm">
              {endError ? <span role="alert">{endError}</span> : null}
              <button
                className="focus-panel__end"
                type="button"
                disabled={isEnding}
                onClick={() => {
                  setConfirmEnd(false);
                  setEndError(null);
                }}
              >
                Keep Focus
              </button>
              <button
                className="focus-panel__end focus-panel__end--danger"
                type="button"
                disabled={isEnding}
                onClick={() => void endFocus()}
              >
                {isEnding ? 'Ending…' : 'Confirm end'}
              </button>
            </div>
          ) : (
            <button className="focus-panel__end" type="button" onClick={() => setConfirmEnd(true)}>
              End Focus
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
