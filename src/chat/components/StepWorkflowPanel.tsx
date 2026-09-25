// src/chat/components/StepWorkflowPanel.tsx

import { useCallback, useEffect, useState } from 'react';

import {
  cancelStepWorkflow,
  getStepWorkflowOverview,
  type StepWorkflowOverview,
} from '../../services/ai/stepbystep/workflowManager';

import './StepWorkflowPanel.css';

const EXPANDED_KEY = 'mocu.stepWorkflow.expanded';

interface StepWorkflowPanelProps {
  chatId: string | null;
  /** Changes whenever the conversation gains a message, so the panel refreshes. */
  refreshKey: number;
  /** Reports whether a workflow panel should be shown in the dock. */
  onActiveChange?: (active: boolean) => void;
}

/** A compact right-side plan and progress view for the active workflow. */
export function StepWorkflowPanel({
  chatId,
  refreshKey,
  onActiveChange,
}: StepWorkflowPanelProps) {
  const [overview, setOverview] = useState<StepWorkflowOverview | null>(null);
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(EXPANDED_KEY) !== '0',
  );
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

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

  useEffect(() => {
    onActiveChange?.(overview?.status === 'active');
  }, [overview, onActiveChange]);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      localStorage.setItem(EXPANDED_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const handleCancel = useCallback(async () => {
    if (!chatId || !overview || overview.status !== 'active' || isCancelling) {
      return;
    }

    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancelStepWorkflow(chatId);
      setOverview((current) => current ? { ...current, status: 'cancelled' } : current);
      setConfirmCancel(false);
      window.dispatchEvent(new CustomEvent('mocu_saved_work_changed', { detail: { chatId } }));
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : 'Could not end the workflow.');
    } finally {
      setIsCancelling(false);
    }
  }, [chatId, overview, isCancelling]);

  if (!overview || overview.status !== 'active') {
    return null;
  }

  const doneCount = overview.steps.filter(
    (step) => step.state === 'done',
  ).length;
  const progress = Math.round((doneCount / overview.totalSteps) * 100);
  const currentStep = overview.steps[overview.currentStepNumber - 1];

  return (
    <section
      className={`step-workflow-panel${expanded ? ' step-workflow-panel--open' : ''}`}
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
          <span className="step-workflow-panel__title">Step by Step</span>
          <span className="step-workflow-panel__meta">
            Step {overview.currentStepNumber} of {overview.totalSteps}
            {!expanded && currentStep ? ` · ${currentStep.title}` : ''}
          </span>
        </span>
        <span className="step-workflow-panel__progress-pill">
          {doneCount}/{overview.totalSteps}
        </span>
        <span
          className={`step-workflow-panel__chevron${expanded ? ' step-workflow-panel__chevron--open' : ''}`}
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
          <div
            className="step-workflow-panel__progress-track"
            role="progressbar"
            aria-label="Workflow progress"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="step-workflow-panel__progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>

          <p className="step-workflow-panel__goal" title={overview.finalGoal}>
            {overview.finalGoal}
          </p>

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
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M3 8.5l3.5 3.5L13 5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : step.stepNumber}
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

          <div className="step-workflow-panel__footer">
            <span className="step-workflow-panel__status">
              {overview.status === 'active'
                ? 'Workflow in progress'
                : overview.status === 'completed'
                  ? 'Workflow completed'
                  : 'Workflow cancelled'}
            </span>
            {confirmCancel ? (
              <div className="step-workflow-panel__confirm">
                {cancelError ? <span role="alert">{cancelError}</span> : null}
                <button
                  type="button"
                  className="step-workflow-panel__cancel"
                  disabled={isCancelling}
                  onClick={() => {
                    setConfirmCancel(false);
                    setCancelError(null);
                  }}
                >
                  Keep working
                </button>
                <button
                  type="button"
                  className="step-workflow-panel__cancel step-workflow-panel__cancel--danger"
                  disabled={isCancelling}
                  onClick={() => void handleCancel()}
                >
                  {isCancelling ? 'Ending…' : 'Confirm end'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="step-workflow-panel__cancel"
                onClick={() => setConfirmCancel(true)}
              >
                End
              </button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
