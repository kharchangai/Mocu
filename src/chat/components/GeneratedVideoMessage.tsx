import { useEffect, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type { GeneratedChatVideo } from '../types/generatedVideo';
import './GeneratedVideoMessage.css';

export function GeneratedVideoCard({ video }: { video: GeneratedChatVideo }) {
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void readFile(video.path).then((bytes) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: video.mimeType }));
      setVideoUrl(objectUrl);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the generated video.');
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video.path, video.mimeType]);

  return (
    <span className="generated-video-card">
      {videoUrl ? <video src={videoUrl} controls playsInline preload="metadata" aria-label={video.name} /> : (
        <span className="generated-video-loading" role={error ? 'alert' : 'status'}>{error || 'Loading generated video...'}</span>
      )}
      <button
        type="button"
        className="generated-video-open"
        title="Show video in folder"
        aria-label={`Show ${video.name} in folder`}
        onClick={() => void revealItemInDir(video.path).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not open the video folder.');
        })}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M12 11v6m0-6 3 3m-3-3-3 3" />
        </svg>
      </button>
    </span>
  );
}
