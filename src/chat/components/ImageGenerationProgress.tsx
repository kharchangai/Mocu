import { useEffect, useState } from 'react';
import './ImageGenerationProgress.css';

export function ImageGenerationProgress({ active }: { active: boolean }) {
  const [seconds, setSeconds] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!active) { setSeconds(0); setExpanded(false); return; }
    setExpanded(false);
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  const progress = Math.min(96, 8 + seconds * 1.7);
  return (
    <div className={`image-generation-progress${expanded ? ' image-generation-progress--expanded' : ''}`}>
      <button
        type="button"
        className="image-generation-progress__toggle"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse image generation progress' : 'Expand image generation progress'}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="image-generation-progress__status" role="status" aria-live="polite">
          <span className="image-generation-progress__status-dot" aria-hidden="true" />
          Creating image - {seconds}s - {Math.round(progress)}%
        </span>
        <span className="image-generation-progress__chevron" aria-hidden="true">{expanded ? '-' : '+'}</span>
      </button>
      {expanded ? (
        <div className="image-generation-progress__body" aria-hidden="true">
          <strong>Creating image</strong>
          <div className="image-generation-progress__dots" />
          <span className="image-generation-progress__percent">{Math.round(progress)}%</span>
        </div>
      ) : null}
    </div>
  );
}
