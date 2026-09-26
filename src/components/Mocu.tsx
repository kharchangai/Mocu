// src/components/Mocu.tsx
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { StatusBubble } from './StatusBubble';
import {
  MocuTranscript,
  TranscriptSpeaker,
} from './MocuTranscript';

export type MocuState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'typing';

interface MocuProps {
  state?: MocuState;

  /*
   * Normal click action.
   * Usually starts/stops microphone recording.
   */
  onClick?: () => void;

  /*
   * Triggered when the user clicks Mocu while it is processing
   * a request or speaking. The parent can abort tools, requests,
   * research pipelines, terminal processes, and audio playback.
   */
  onInterrupt?: () => void;

  /*
   * Optional static transcript support.
   * This does not resize the window or move Mocu dynamically.
   */
  transcriptText?: string;
  transcriptSpeaker?: TranscriptSpeaker;
  transcriptDelay?: number;
  transcriptVisibleFor?: number;
  transcriptEnabled?: boolean;
  onTranscriptHidden?: () => void;
}

/*
 * Fixed layout budget.
 *
 * TOP_SPACE:
 * Space required for StatusBubble above Mocu.
 *
 * CUBE_SIZE:
 * The fixed design size of Mocu. The face is always drawn at this size
 * and then scaled down as a whole by CUBE_SCALE, so every proportion
 * (eyes, mouth, glow, status bubble) stays exact.
 *
 * Since MocuTranscript can display up to four lines, this needs enough
 * room for the transcript card, its 12px top margin, and safe spacing.
 */
const TOP_SPACE = 0;

/*
 * Exported so App.tsx can compute the cube's on-screen rectangle for
 * the click-through toggle (see useMocuClickThrough).
 */
export const CUBE_SIZE = 150;

/*
 * How large Mocu appears on screen. 0.8 shrinks the 150px design to
 * a 120px avatar. Tweak this single value to make Mocu smaller/bigger.
 */
export const CUBE_SCALE = 0.8;

/*
 * The actual on-screen footprint of the cube. Exported so App.tsx can
 * compute the click-through rectangle at the rendered (scaled) size.
 */
export const CUBE_DISPLAY_SIZE = CUBE_SIZE * CUBE_SCALE;

export const Mocu: React.FC<MocuProps> = ({
  state = 'idle',
  onClick,
  onInterrupt,
  transcriptText = '',
  transcriptSpeaker = 'mocu',
  transcriptDelay = 800,
  transcriptVisibleFor = 7000,
  transcriptEnabled = true,
  onTranscriptHidden,
}) => {
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let openEyesTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const blink = () => {
      if (cancelled) {
        return;
      }

      setIsBlinking(true);

      openEyesTimer = setTimeout(() => {
        if (!cancelled) {
          setIsBlinking(false);
        }
      }, 150);

      blinkTimer = setTimeout(
        blink,
        3000 + Math.random() * 5000,
      );
    };

    blinkTimer = setTimeout(blink, 2000);

    return () => {
      cancelled = true;

      if (blinkTimer) {
        clearTimeout(blinkTimer);
      }

      if (openEyesTimer) {
        clearTimeout(openEyesTimer);
      }
    };
  }, []);

  /*
   * Normal behavior:
   * - idle / happy / typing: invoke normal click action.
   * - listening: invoke normal click action so parent can stop recording.
   *
   * Interrupt behavior:
   * - thinking: cancel an active request, tool, research, or LLM call.
   * - speaking: stop generated speech and cancel any active request.
   */
  const handleMocuClick = () => {
    const isWorking =
      state === 'thinking' ||
      state === 'speaking';

    if (isWorking) {
      onInterrupt?.();
      return;
    }

    onClick?.();
  };

  const springConfig = {
    type: 'spring' as const,
    damping: 16,
    stiffness: 180,
    mass: 0.9,
  };

  const eyeVariants = {
    idle: {
      scaleY: isBlinking ? 0.05 : 1,
      scaleX: 1,
      x: 0,
      y: 0,
    },

    listening: {
      scaleY: isBlinking ? 0.05 : 1.3,
      scaleX: 1.1,
      x: 0,
      y: -4,
    },

    thinking: {
      scaleY: 0.6,
      scaleX: 1.1,
      x: [0, 6, 6, 0],
      y: -6,
      transition: {
        duration: 3,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },

    speaking: {
      scaleY: isBlinking ? 0.05 : [1, 1.1, 0.9, 1],
      transition: {
        repeat: Infinity,
        duration: 1.5,
      },
    },

    happy: {
      scaleY: 0.15,
      scaleX: 1.2,
      x: 0,
      y: -4,
    },

    typing: {
      scaleY: isBlinking ? 0.05 : 0.85,
      scaleX: 1,
      x: [-5, 5, 5, -5, -5],
      y: 3,
      transition: {
        x: {
          repeat: Infinity,
          duration: 2.5,
          ease: 'easeInOut',
        },
        default: springConfig,
      },
    },
  };

  const mouthVariants = {
    idle: {
      height: 4,
      width: 20,
      borderRadius: 2,
      x: 0,
      y: 0,
    },

    listening: {
      height: 14,
      width: 14,
      borderRadius: 2,
      x: 0,
      y: 0,
    },

    thinking: {
      height: 3,
      width: 12,
      borderRadius: 2,
      x: 8,
      y: -2,
    },

    speaking: {
      height: [4, 18, 8, 14, 4],
      width: [20, 14, 22, 16, 20],
      borderRadius: [2, 2, 2, 2, 2],
      transition: {
        repeat: Infinity,
        duration: 0.5,
        ease: 'easeInOut',
      },
    },

    happy: {
      height: 12,
      width: 32,
      borderRadius: '0 0 16px 16px',
      x: 0,
      y: 2,
    },

    typing: {
      height: 4,
      width: 16,
      borderRadius: 2,
      x: 0,
      y: 4,
    },
  };

  const bodyVariants = {
    idle: {
      y: [0, -10, 0],
      scaleX: [1, 0.98, 1.02, 1],
      scaleY: [1, 1.02, 0.98, 1],
      transition: {
        repeat: Infinity,
        duration: 3.5,
        ease: 'easeInOut',
      },
    },

    thinking: {
      y: -5,
      transition: {
        repeat: Infinity,
        duration: 4,
        ease: 'easeInOut',
      },
    },

    typing: {
      y: [5, 7, 5],
      scaleY: [1, 0.99, 1],
      transition: {
        repeat: Infinity,
        duration: 2,
        ease: 'easeInOut',
      },
    },

    default: {
      y: 0,
      scaleX: 1,
      scaleY: 1,
    },
  };

  const bodyAnimation =
    state === 'idle' ||
    state === 'typing' ||
    state === 'thinking'
      ? state
      : 'default';

  return (
    <div
      className="relative w-full overflow-visible"
      style={{
        height: TOP_SPACE + CUBE_DISPLAY_SIZE,
      }}
    >
      {/*
       * This wrapper has a fixed position and fixed size.
       * The transcript is absolutely positioned, so it never changes
       * Mocu's layout height and cannot push Mocu upward.
       */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          top: TOP_SPACE,
          width: CUBE_DISPLAY_SIZE,
          height: CUBE_DISPLAY_SIZE,
        }}
      >
        {/*
         * Cube + status bubble are drawn at the 150px design size and
         * scaled down as one block, so the face stays proportional.
         * The transcript below is rendered outside this block so its
         * text keeps its normal readable size.
         */}
        <div
          className="absolute left-0 top-0"
          style={{
            width: CUBE_SIZE,
            height: CUBE_SIZE,
            transform: `scale(${CUBE_SCALE})`,
            transformOrigin: 'top left',
          }}
        >
        <StatusBubble state={state} />

        <motion.div
          onClick={handleMocuClick}
          data-tauri-drag-region
          className="absolute left-0 top-0 z-20 flex cursor-pointer items-center justify-center overflow-hidden rounded-[12px] bg-[#050505] transition-transform active:scale-95"
          style={{
            width: CUBE_SIZE,
            height: CUBE_SIZE,
            boxShadow: `
              inset 0 2px 10px rgba(255, 255, 255, 0.15),
              inset 0 -10px 20px rgba(0, 0, 0, 0.8)
            `,
            border: '1px solid rgba(255, 255, 255, 0.05)',
          }}
          animate={bodyVariants[bodyAnimation]}
          whileHover={{
            scale: 1.05,
            rotate: -2,
          }}
          whileTap={{
            scale: 0.95,
            rotate: 0,
          }}
        >
          <div className="pointer-events-none absolute left-3 top-0 h-[40px] w-[110px] rounded-b-[24px] rounded-t-[12px] bg-gradient-to-b from-white/10 to-transparent" />

          <div className="pointer-events-none z-30 flex translate-y-1 flex-col items-center gap-4">
            {/* eyes + mouth (design size, scaled with the cube) */}
            <div className="flex w-full justify-center gap-6">
              <motion.div
                className="h-[20px] w-[18px] rounded-[4px] bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]"
                animate={state}
                variants={eyeVariants}
                transition={springConfig}
              />

              <motion.div
                className="h-[20px] w-[18px] rounded-[4px] bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]"
                animate={state}
                variants={eyeVariants}
                transition={springConfig}
              />
            </div>

            <motion.div
              className="bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]"
              animate={state}
              variants={mouthVariants}
              transition={springConfig}
            />
          </div>
        </motion.div>
        </div>

        <div className="absolute left-1/2 top-full z-40 mt-3 w-[230px] -translate-x-1/2">
          <MocuTranscript
            text={transcriptText}
            speaker={transcriptSpeaker}
            delay={transcriptDelay}
            visibleFor={transcriptVisibleFor}
            enabled={transcriptEnabled}
            onHidden={onTranscriptHidden}
          />
        </div>
      </div>
    </div>
  );
};