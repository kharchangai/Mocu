// src/App.tsx
import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import { Mocu, MocuState } from './components/Mocu';
import { Settings } from './components/Settings';
import ChatPage from './chat/ChatPage';
import { TranscriptSpeaker } from './components/MocuTranscript';

import {
  generateSpeech,
  isAbortError,
  transcribeAudio,
} from './services/aiService';

import { chatWithMocu } from './services/ai/index';
import { useScheduleTrigger } from './hooks/useScheduleTrigger';
import { useMocuWindowSize } from './hooks/useMocuWindowSize';

import { runTest } from './test';

type ActivityEvent = {
  text: string;
  isRunning: boolean;
};

type MocuInterruptEvent = {
  reason: 'user-click';
  timestamp: number;
};

const MAIN_WINDOW_WIDTH = 250;
const MAIN_WINDOW_BASE_HEIGHT = 320;
const TRANSCRIPT_EXTRA_HEIGHT = 170;

function getCurrentRouteHash(): string {
  return window.location.hash;
}

function App() {
  const [routeHash, setRouteHash] = useState(getCurrentRouteHash);

  const [mocuState, setMocuState] = useState<MocuState>('idle');
  const [, setCurrentActivity] = useState<string | null>(null);

  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptSpeaker, setTranscriptSpeaker] =
    useState<TranscriptSpeaker>('mocu');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const typingTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const pipelineIdRef = useRef(0);

  const hasRunAtomicMemoryTestRef = useRef(false);

  const isSettingsWindow = routeHash === '#settings';
  const isChatWindow = routeHash === '#chat';

  /*
   * The compact Mocu window is the default route only.
   *
   * It is important that the resize hook is disabled for both Chat and
   * Settings. Otherwise the chat window can be forced back to 250x320.
   */
  const isMocuWindow = !isSettingsWindow && !isChatWindow;

  const { resizeWindow } = useMocuWindowSize({
    width: MAIN_WINDOW_WIDTH,
    baseHeight: MAIN_WINDOW_BASE_HEIGHT,
    transcriptExtraHeight: TRANSCRIPT_EXTRA_HEIGHT,
    disabled: !isMocuWindow,
  });

  useEffect(() => {
    const syncRoute = () => {
      setRouteHash(getCurrentRouteHash());
    };

    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('tauri://navigate', syncRoute);

    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('tauri://navigate', syncRoute);
    };
  }, []);

  const stopCurrentAudio = () => {
    const currentAudio = currentAudioRef.current;

    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio.onended = null;
      currentAudio.onerror = null;
      currentAudio.src = '';
      currentAudioRef.current = null;
    }

    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
  };

  const abortActivePipeline = () => {
    const controller = abortControllerRef.current;

    if (controller && !controller.signal.aborted) {
      controller.abort();
    }

    abortControllerRef.current = null;
  };

  const createNewPipeline = () => {
    abortActivePipeline();

    const pipelineId = pipelineIdRef.current + 1;
    pipelineIdRef.current = pipelineId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    return {
      pipelineId,
      signal: controller.signal,
    };
  };

  const dispatchInterruptEvent = () => {
    const detail: MocuInterruptEvent = {
      reason: 'user-click',
      timestamp: Date.now(),
    };

    window.dispatchEvent(
      new CustomEvent<MocuInterruptEvent>('mocu-interrupt', {
        detail,
      }),
    );
  };

  const handleInterrupt = () => {
    pipelineIdRef.current += 1;

    abortActivePipeline();
    stopCurrentAudio();

    const mediaRecorder = mediaRecorderRef.current;

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }

    mediaRecorder?.stream
      .getTracks()
      .forEach((track) => track.stop());

    mediaRecorderRef.current = null;
    audioChunksRef.current = [];

    setCurrentActivity(null);
    setMocuState('idle');
    setTranscriptText('');

    dispatchInterruptEvent();
  };

  const playSpeech = async (
    text: string,
    pipelineId: number,
    signal: AbortSignal,
  ) => {
    stopCurrentAudio();

    if (
      pipelineId !== pipelineIdRef.current ||
      signal.aborted
    ) {
      return;
    }

    const speechBlob = await generateSpeech(text, signal);

    if (
      pipelineId !== pipelineIdRef.current ||
      signal.aborted
    ) {
      return;
    }

    const audioUrl = URL.createObjectURL(speechBlob);
    const audio = new Audio(audioUrl);

    currentAudioRef.current = audio;
    currentAudioUrlRef.current = audioUrl;

    const cleanUpAudio = () => {
      audio.onended = null;
      audio.onerror = null;

      if (currentAudioRef.current === audio) {
        currentAudioRef.current = null;
      }

      if (currentAudioUrlRef.current === audioUrl) {
        URL.revokeObjectURL(audioUrl);
        currentAudioUrlRef.current = null;
      }
    };

    audio.onended = () => {
      cleanUpAudio();

      if (
        pipelineId === pipelineIdRef.current &&
        !signal.aborted
      ) {
        setMocuState('idle');
      }
    };

    audio.onerror = () => {
      cleanUpAudio();

      if (
        pipelineId === pipelineIdRef.current &&
        !signal.aborted
      ) {
        setMocuState('idle');
      }
    };

    if (
      pipelineId !== pipelineIdRef.current ||
      signal.aborted
    ) {
      cleanUpAudio();
      return;
    }

    setMocuState('speaking');

    try {
      await audio.play();
    } catch (error) {
      cleanUpAudio();
      throw error;
    }
  };

  useEffect(() => {
    if (!isMocuWindow || hasRunAtomicMemoryTestRef.current) {
      return;
    }

    hasRunAtomicMemoryTestRef.current = true;

    const executeTest = async () => {
      try {
        await runTest();
      } catch (error) {
        console.error('[Atomic memory test] Failed:', error);
      }
    };

    void executeTest();
  }, [isMocuWindow]);

  useEffect(() => {
    if (!isMocuWindow) {
      return;
    }

    const transcriptIsVisible = transcriptText.trim().length > 0;

    void resizeWindow(transcriptIsVisible);
  }, [isMocuWindow, resizeWindow, transcriptText]);

  useEffect(() => {
    if (!isMocuWindow) {
      return;
    }

    const handleActivity = (event: Event) => {
      const customEvent = event as CustomEvent<ActivityEvent>;

      if (customEvent.detail.isRunning) {
        setCurrentActivity(customEvent.detail.text);
      } else {
        setCurrentActivity(null);
      }
    };

    window.addEventListener(
      'mocu-tool-status',
      handleActivity as EventListener,
    );

    return () => {
      window.removeEventListener(
        'mocu-tool-status',
        handleActivity as EventListener,
      );
    };
  }, [isMocuWindow]);

  useEffect(() => {
    if (!isMocuWindow) {
      return;
    }

    let disposed = false;
    let unlistenTyping: (() => void) | undefined;

    const setupListener = async () => {
      try {
        const unlisten = await listen('user_typing', () => {
          setMocuState((previousState) => {
            if (
              previousState !== 'typing' &&
              previousState !== 'listening' &&
              previousState !== 'thinking' &&
              previousState !== 'speaking'
            ) {
              return 'typing';
            }

            return previousState;
          });

          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }

          typingTimeoutRef.current = setTimeout(() => {
            setMocuState((previousState) =>
              previousState === 'typing'
                ? 'idle'
                : previousState,
            );
          }, 1000);
        });

        if (disposed) {
          unlisten();
          return;
        }

        unlistenTyping = unlisten;
      } catch (error) {
        console.error('Failed to listen for user typing:', error);
      }
    };

    void setupListener();

    return () => {
      disposed = true;
      unlistenTyping?.();

      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
    };
  }, [isMocuWindow]);

  useEffect(() => {
    return () => {
      pipelineIdRef.current += 1;

      abortActivePipeline();
      stopCurrentAudio();

      const mediaRecorder = mediaRecorderRef.current;

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }

      mediaRecorder?.stream
        .getTracks()
        .forEach((track) => track.stop());

      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    };
  }, []);

  const handleScheduleTrigger = async (ttsText: string) => {
    const { pipelineId, signal } = createNewPipeline();

    stopCurrentAudio();

    setTranscriptSpeaker('mocu');
    setTranscriptText(ttsText);
    setMocuState('thinking');

    try {
      await playSpeech(ttsText, pipelineId, signal);
    } catch (error) {
      if (
        pipelineId !== pipelineIdRef.current ||
        signal.aborted ||
        isAbortError(error)
      ) {
        return;
      }

      console.error('Schedule trigger TTS error:', error);
      setMocuState('idle');
    }
  };

  useScheduleTrigger(
    handleScheduleTrigger,
    !isMocuWindow,
  );

  const handleToggleRecording = async () => {
    if (mocuState === 'listening') {
      const mediaRecorder = mediaRecorderRef.current;

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }

      return;
    }

    if (
      mocuState !== 'idle' &&
      mocuState !== 'happy' &&
      mocuState !== 'typing' &&
      mocuState !== 'speaking'
    ) {
      return;
    }

    const { pipelineId, signal } = createNewPipeline();

    stopCurrentAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      if (
        pipelineId !== pipelineIdRef.current ||
        signal.aborted
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const supportedMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ];

      const mimeType = supportedMimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type),
      );

      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);

        stream.getTracks().forEach((track) => track.stop());

        mediaRecorderRef.current = null;
        audioChunksRef.current = [];

        if (
          pipelineId === pipelineIdRef.current &&
          !signal.aborted
        ) {
          setMocuState('idle');
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        mediaRecorderRef.current = null;

        if (
          pipelineId !== pipelineIdRef.current ||
          signal.aborted
        ) {
          audioChunksRef.current = [];
          return;
        }

        setMocuState('thinking');

        const recordedMimeType =
          mediaRecorder.mimeType ||
          audioChunksRef.current[0]?.type ||
          'audio/webm';

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recordedMimeType,
        });

        audioChunksRef.current = [];

        try {
          const transcribedText = await transcribeAudio(
            audioBlob,
            signal,
          );

          if (
            pipelineId !== pipelineIdRef.current ||
            signal.aborted
          ) {
            return;
          }

          const userText =
            typeof transcribedText === 'string'
              ? transcribedText.trim()
              : '';

          console.log('Transcribed:', userText);

          if (!userText) {
            setMocuState('idle');
            return;
          }

          setTranscriptSpeaker('user');
          setTranscriptText(userText);

          const response = await chatWithMocu(userText, signal);

          if (
            pipelineId !== pipelineIdRef.current ||
            signal.aborted
          ) {
            return;
          }

          let botResponseText =
            typeof response === 'string'
              ? response.trim()
              : '';

          if (!botResponseText) {
            console.warn(
              'Received an empty response from the backend.',
            );

            botResponseText = 'Understood, task completed.';
          }

          console.log('Model response:', botResponseText);

          setTranscriptSpeaker('mocu');
          setTranscriptText(botResponseText);

          await playSpeech(
            botResponseText,
            pipelineId,
            signal,
          );
        } catch (error: unknown) {
          if (
            pipelineId !== pipelineIdRef.current ||
            signal.aborted ||
            isAbortError(error)
          ) {
            console.log('AI pipeline was cancelled.');
            return;
          }

          console.error('AI pipeline error:', error);
          setMocuState('idle');
        } finally {
          if (
            pipelineId === pipelineIdRef.current &&
            !signal.aborted
          ) {
            setCurrentActivity(null);
          }
        }
      };

      mediaRecorder.start();
      setMocuState('listening');
    } catch (error: unknown) {
      if (
        pipelineId !== pipelineIdRef.current ||
        signal.aborted ||
        isAbortError(error)
      ) {
        return;
      }

      console.error('Microphone access failed:', error);
      setMocuState('idle');
    }
  };

  if (isSettingsWindow) {
    return <Settings />;
  }

  if (isChatWindow) {
    return <ChatPage />;
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-transparent select-none">
      <div
        className="absolute left-0 top-0 flex w-full items-center justify-center"
        style={{
          height: `${MAIN_WINDOW_BASE_HEIGHT}px`,
        }}
      >
        <Mocu
          state={mocuState}
          onClick={handleToggleRecording}
          onInterrupt={handleInterrupt}
          transcriptText={transcriptText}
          transcriptSpeaker={transcriptSpeaker}
          transcriptEnabled
          transcriptDelay={0}
          transcriptVisibleFor={7000}
          onTranscriptHidden={() => {
            setTranscriptText('');
          }}
        />
      </div>
    </div>
  );
}

export default App;