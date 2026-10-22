import { useEffect, useState } from 'react';
import './ImageGenerationProgress.css';

export function ImageGenerationProgress({ active }: { active: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) { setSeconds(0); return; }
    const startedAt = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  const progress = Math.min(96, 8 + seconds * 1.7);
  return (
    <div className="image-generation-progress" role="status" aria-live="polite">
      <div className="image-generation-progress__top">Working for {seconds}s</div>
      <div className="image-generation-progress__body">
        <strong>Creating image</strong>
        <div className="image-generation-progress__dots" aria-hidden="true" />
        <span className="image-generation-progress__percent">{Math.round(progress)}%</span>
      </div>
    </div>
  );
}
