import { useCallback, useEffect, useRef, useState } from "react";

import { transcribeAudio } from "../../services/aiService";

/**
 * Speech-to-text recorder hook for the chat input.
 *
 * Records from the microphone and transcribes with the STT model the
 * user configured in Settings (the same transcribeAudio() pipeline the
 * Mocu avatar uses).
 *
 * Because the transcription endpoint is not token-streaming, live text
 * is produced with rolling transcription: every few seconds the audio
 * recorded so far is transcribed and reported through onPartialText so
 * text appears in the input box while speaking. When recording stops,
 * the full recording is transcribed once and reported through
 * onFinalText as the accurate final text.
 */

const PARTIAL_TRANSCRIBE_INTERVAL_MS = 3_000;
const LEVEL_SAMPLE_INTERVAL_MS = 60;
const ELAPSED_TICK_MS = 500;
const WAVEFORM_BARS = 28;
const MAX_RECORDING_MS = 5 * 60_000;

const SUPPORTED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export type UseSpeechRecorderOptions = {
  /** Called with the rolling partial transcript while recording. */
  onPartialText?: (text: string) => void;
  /** Called once with the accurate full transcript after stopping. */
  onFinalText?: (text: string) => void;
};

export type SpeechRecorder = {
  isRecording: boolean;
  isTranscribing: boolean;
  /** Normalized 0..1 microphone levels for the waveform, oldest first. */
  levels: number[];
  elapsedMs: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
};

/**
 * Joins the text already in the composer with a spoken transcript.
 * The streamed text replaces the previous spoken part, so partial
 * updates refine the text instead of duplicating it.
 */
export const joinVoiceText = (base: string, spoken: string): string => {
  const trimmedBase = base.replace(/\s+$/, "");
  const trimmedSpoken = spoken.trim();

  if (!trimmedSpoken) {
    return base;
  }

  if (!trimmedBase) {
    return trimmedSpoken;
  }

  return `${trimmedBase} ${trimmedSpoken}`;
};

const emptyLevels = (): number[] => new Array<number>(WAVEFORM_BARS).fill(0);

export const useSpeechRecorder = (
  options: UseSpeechRecorderOptions = {},
): SpeechRecorder => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [levels, setLevels] = useState<number[]>(emptyLevels);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordedMimeTypeRef = useRef("audio/webm");

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const levelTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const partialTimerRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const transcribeBusyRef = useRef(false);
  const cancelledRef = useRef(false);
  const sessionIdRef = useRef(0);

  const clearTimer = (ref: { current: number | null }): void => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      window.clearInterval(ref.current);
      ref.current = null;
    }
  };

  const teardownMedia = useCallback(() => {
    clearTimer(levelTimerRef);
    clearTimer(elapsedTimerRef);
    clearTimer(partialTimerRef);
    clearTimer(autoStopTimerRef);

    const stream = streamRef.current;
    streamRef.current = null;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    analyserRef.current = null;

    if (audioContext) {
      void audioContext.close().catch(() => undefined);
    }

    mediaRecorderRef.current = null;
  }, []);

  const transcribeRecordedAudio = useCallback(
    async (mode: "partial" | "final"): Promise<void> => {
      if (transcribeBusyRef.current || cancelledRef.current) {
        return;
      }

      const chunks = audioChunksRef.current;

      if (chunks.length === 0) {
        return;
      }

      transcribeBusyRef.current = true;
      setIsTranscribing(true);

      try {
        const audioBlob = new Blob(chunks, {
          type: recordedMimeTypeRef.current,
        });

        const text = (
          await transcribeAudio(audioBlob, abortRef.current?.signal) ?? ""
        ).trim();

        if (cancelledRef.current) {
          return;
        }

        if (mode === "partial") {
          if (text) {
            optionsRef.current.onPartialText?.(text);
          }
        } else {
          optionsRef.current.onFinalText?.(text);
        }
      } catch (transcribeError: unknown) {
        if (cancelledRef.current) {
          return;
        }

        const message =
          transcribeError instanceof Error
            ? transcribeError.message
            : String(transcribeError);

        if (mode === "final") {
          setError(message);
        } else {
          // Partial failures are non-fatal; the final pass reports errors.
          console.warn("[Speech] Partial transcription failed:", message);
        }
      } finally {
        transcribeBusyRef.current = false;
        setIsTranscribing(false);
      }
    },
    [],
  );

  const start = useCallback(async (): Promise<void> => {
    if (mediaRecorderRef.current) {
      return;
    }

    cancelledRef.current = false;
    sessionIdRef.current += 1;
    const sessionId = sessionIdRef.current;

    audioChunksRef.current = [];
    setLevels(emptyLevels());
    setElapsedMs(0);
    setError(null);

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (micError: unknown) {
      const message =
        micError instanceof Error ? micError.message : String(micError);
      setError(`Microphone unavailable: ${message}`);
      return;
    }

    if (cancelledRef.current || sessionId !== sessionIdRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;

    const mimeType = SUPPORTED_MIME_TYPES.find((type) => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch {
        return false;
      }
    });

    recordedMimeTypeRef.current = mimeType ?? "audio/webm";

    let mediaRecorder: MediaRecorder;

    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (recorderError: unknown) {
      stream.getTracks().forEach((track) => track.stop());
      const message =
        recorderError instanceof Error
          ? recorderError.message
          : String(recorderError);
      setError(`Could not start recording: ${message}`);
      return;
    }

    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error("[Speech] MediaRecorder error:", event);
      teardownMedia();
      setIsRecording(false);
      setError("Recording failed unexpectedly.");
    };

    mediaRecorder.onstop = () => {
      const wasCancelled = cancelledRef.current;

      teardownMedia();
      setIsRecording(false);

      if (wasCancelled) {
        audioChunksRef.current = [];
        return;
      }

      void transcribeRecordedAudio("final");
    };

    // Waveform: sample the microphone level into a rolling bar buffer.
    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (AudioContextCtor) {
        const audioContext = new AudioContextCtor();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();

        analyser.fftSize = 256;
        source.connect(analyser);

        audioContextRef.current = audioContext;
        analyserRef.current = analyser;

        const buffer = new Uint8Array(analyser.fftSize);

        levelTimerRef.current = window.setInterval(() => {
          const activeAnalyser = analyserRef.current;

          if (!activeAnalyser) {
            return;
          }

          activeAnalyser.getByteTimeDomainData(buffer);

          let sumSquares = 0;

          for (let index = 0; index < buffer.length; index += 1) {
            const sample = (buffer[index] - 128) / 128;
            sumSquares += sample * sample;
          }

          const rms = Math.sqrt(sumSquares / buffer.length);
          // Apply a gentle curve so quiet speech is still visible.
          const level = Math.min(1, Math.pow(rms * 3.2, 0.7));

          setLevels((previous) => {
            const next = previous.slice(1);
            next.push(level);
            return next;
          });
        }, LEVEL_SAMPLE_INTERVAL_MS);
      }
    } catch (analyserError: unknown) {
      // The waveform is cosmetic; recording continues without it.
      console.warn("[Speech] Waveform unavailable:", analyserError);
    }

    const startedAt = Date.now();

    elapsedTimerRef.current = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, ELAPSED_TICK_MS);

    partialTimerRef.current = window.setInterval(() => {
      void transcribeRecordedAudio("partial");
    }, PARTIAL_TRANSCRIBE_INTERVAL_MS);

    autoStopTimerRef.current = window.setTimeout(() => {
      mediaRecorderRef.current?.stop();
    }, MAX_RECORDING_MS);

    setIsRecording(true);

    // Collect small chunks frequently so partial transcriptions are fresh.
    mediaRecorder.start(500);
  }, [teardownMedia, transcribeRecordedAudio]);

  const stop = useCallback((): void => {
    const mediaRecorder = mediaRecorderRef.current;

    if (!mediaRecorder) {
      return;
    }

    cancelledRef.current = false;
    clearTimer(partialTimerRef);

    if (mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }, []);

  const cancel = useCallback((): void => {
    cancelledRef.current = true;
    transcribeBusyRef.current = false;

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    audioChunksRef.current = [];

    const mediaRecorder = mediaRecorderRef.current;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      teardownMedia();
    }

    setIsRecording(false);
    setIsTranscribing(false);
    setLevels(emptyLevels());
    setElapsedMs(0);
    setError(null);
  }, [teardownMedia]);

  useEffect(() => {
    abortRef.current = new AbortController();

    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
      teardownMedia();
    };
  }, [teardownMedia]);

  return {
    isRecording,
    isTranscribing,
    levels,
    elapsedMs,
    error,
    start,
    stop,
    cancel,
  };
};
