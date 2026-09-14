// src/chat/components/MocuMiniCube.tsx
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';

import './MocuMiniCube.css';

/*
 * Small floating Mocu cube with blinking eyes, shown at the bottom of
 * the chat page. Clicking it toggles the full Mocu avatar window:
 * hidden -> shown, shown -> hidden (via the `toggle_mocu` command).
 */
export function MocuMiniCube() {
  const [isBlinking, setIsBlinking] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isAvatarVisible, setIsAvatarVisible] = useState(false);

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

  const handleToggleMocu = async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    setIsBusy(true);

    try {
      const nowVisible = await invoke<boolean>(
        'toggle_mocu',
      );

      setIsAvatarVisible(nowVisible);
    } catch (error) {
      console.error(
        '[Mocu Mini Cube] Failed to toggle the Mocu avatar:',
        error,
      );
    } finally {
      /*
       * Debounce repeated clicks so the toggle always matches one
       * click per state change.
       */
      setTimeout(() => setIsBusy(false), 400);
    }
  };

  return (
    <motion.button
      type="button"
      className={`mocu-mini-cube${
        isAvatarVisible
          ? ' mocu-mini-cube--active'
          : ''
      }`}
      onClick={() => {
        void handleToggleMocu();
      }}
      title={
        isAvatarVisible
          ? 'Hide Mocu'
          : 'Show Mocu'
      }
      aria-label="Show Mocu avatar"
      animate={{
        scaleY: isBusy ? 0.9 : [1, 0.97, 1.02, 1],
        y: isBusy ? 1 : [0, -2, 0],
      }}
      transition={{
        duration: 3.5,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
      whileHover={{
        scale: 1.08,
        rotate: -2,
      }}
      whileTap={{
        scale: 0.94,
      }}
    >
      <span className="mocu-mini-cube-gloss" />

      <span className="mocu-mini-cube-face">
        <span className="mocu-mini-cube-eyes">
          <motion.span
            className="mocu-mini-cube-eye"
            animate={{
              scaleY: isBlinking ? 0.08 : 1,
            }}
            transition={{
              duration: 0.15,
            }}
          />

          <motion.span
            className="mocu-mini-cube-eye"
            animate={{
              scaleY: isBlinking ? 0.08 : 1,
            }}
            transition={{
              duration: 0.15,
            }}
          />
        </span>

        <span className="mocu-mini-cube-mouth" />
      </span>
    </motion.button>
  );
}