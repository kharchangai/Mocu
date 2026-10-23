import { useEffect, useRef, useState } from 'react';
import { exists, readFile } from '@tauri-apps/plugin-fs';
import type { GeneratedChatAudio } from '../types/generatedAudio';
import './GeneratedAudioPlayer.css';

export function GeneratedAudioPlayer({ audio }: { audio: GeneratedChatAudio }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    const player = audioRef.current;
    if (player) {
      player.pause();
      player.onended = null;
      player.onerror = null;
    }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const togglePlayback = async (): Promise<void> => {
    const current = audioRef.current;
    if (current) {
      if (current.paused) {
        try {
          await current.play();
          setIsPlaying(true);
          setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not play this audio.');
        }
      } else {
        current.pause();
        setIsPlaying(false);
      }
      return;
    }

    if (isLoading) return;
    setIsLoading(true);
    setError('');
    try {
      const fileExists = await exists(audio.path);
      if (!fileExists) throw new Error('The saved audio file could not be found.');
      const bytes = await readFile(audio.path);
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: audio.mimeType }));
      const player = new Audio(url);
      urlRef.current = url;
      audioRef.current = player;
      player.onended = () => setIsPlaying(false);
      player.onerror = () => {
        setIsPlaying(false);
        setError('Could not play this audio.');
      };
      await player.play();
      setIsPlaying(true);
    } catch (cause) {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      audioRef.current = null;
      setError(cause instanceof Error ? cause.message : 'Could not load this audio.');
    } finally {
      setIsLoading(false);
    }
  };

  const spokenText = audio.text.trim();
  const title = error || (spokenText ? `Play pronunciation: ${spokenText}` : `Play ${audio.name}`);

  return (
    <button
      type="button"
      className="generated-audio-player"
      onClick={() => void togglePlayback()}
      disabled={isLoading}
      aria-label={isLoading ? 'Loading audio' : isPlaying ? 'Pause audio' : title}
      title={title}
    >
      {isLoading ? (
        <span className="generated-audio-player__spinner" aria-hidden="true" />
      ) : isPlaying ? (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="3" height="10" rx=".7" fill="currentColor" /><rect x="10" y="3" width="3" height="10" rx=".7" fill="currentColor" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 2.8c0-.7.8-1.1 1.4-.7l8 5.2a.85.85 0 0 1 0 1.4l-8 5.2c-.6.4-1.4 0-1.4-.7z" fill="currentColor" /></svg>
      )}
    </button>
  );
}
