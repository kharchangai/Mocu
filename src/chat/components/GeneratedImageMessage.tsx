import { useEffect, useState } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import type { GeneratedChatImage } from '../types/generatedImage';
import './GeneratedImageMessage.css';

export function GeneratedImageCard({ image }: { image: GeneratedChatImage }) {
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    void readFile(image.path).then((bytes) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: image.mimeType }));
      setImageUrl(objectUrl);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the generated image.');
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.path, image.mimeType]);

  return (
    <span className="generated-image-card">
      {imageUrl ? <img src={imageUrl} alt={image.name} loading="lazy" /> : (
        <span className="generated-image-loading" role={error ? 'alert' : 'status'}>
          {error || 'Loading generated image…'}
        </span>
      )}
      <button
        type="button"
        className="generated-image-open"
        title="Show image in folder"
        aria-label={`Show ${image.name} in folder`}
        onClick={() => void revealItemInDir(image.path).catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : 'Could not open the image folder.');
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

export function GeneratedImageMessage({ images }: { images: GeneratedChatImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className="generated-image-message" aria-label="Generated images">
      {images.map((image) => <GeneratedImageCard image={image} key={image.id} />)}
    </div>
  );
}
