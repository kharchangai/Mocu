// src/hooks/useMocuClickThrough.ts
import { useEffect, useRef } from 'react';
import {
  cursorPosition,
  getCurrentWindow,
} from '@tauri-apps/api/window';

type UseMocuClickThroughOptions = {
  width: number;
  baseHeight: number;
  transcriptExtraHeight: number;
  cubeLeft: number;
  cubeTop: number;
  cubeSize: number;

  /*
   * True while the transcript card is shown (window is expanded).
   * In that state the region below the cube must also accept clicks
   * so the user can hover and scroll the transcript.
   */
  transcriptVisible: boolean;

  disabled?: boolean;
};

/*
 * How often (ms) to check whether the global cursor is over an
 * interactive region of the Mocu window.
 */
const POLL_INTERVAL_MS = 50;

/*
 * Extra margin around the cube rect so hover effects (whileHover
 * scale 1.05) and fast mouse movement do not lose interactivity
 * at the cube's edges.
 */
const INTERACTIVE_PADDING = 10;

/*
 * Transparent Tauri windows still hit-test as a solid rectangle at the
 * OS level, so by default the Mocu window blocks all clicks to items
 * behind it (even on fully transparent pixels).
 *
 * This hook makes the window click-through by default and only
 * enables mouse input while the cursor is over an interactive region:
 *
 * - the Mocu cube (always), or
 * - the transcript area (only while the transcript is visible).
 *
 * Because a click-through window receives NO DOM mouse events, the
 * cursor position is tracked from the OS (cursorPosition) instead of
 * webview events, and setIgnoreCursorEvents is toggled on/off.
 */
export function useMocuClickThrough({
  width,
  baseHeight,
  transcriptExtraHeight,
  cubeLeft,
  cubeTop,
  cubeSize,
  transcriptVisible,
  disabled = false,
}: UseMocuClickThroughOptions) {
  const ignoreStateRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (disabled) {
      return;
    }

    const appWindow = getCurrentWindow();
    let disposed = false;

    const applyIgnore = async (ignore: boolean) => {
      if (ignoreStateRef.current === ignore) {
        return;
      }

      ignoreStateRef.current = ignore;

      try {
        await appWindow.setIgnoreCursorEvents(ignore);
      } catch (error) {
        console.error(
          'Failed to toggle click-through state:',
          error,
        );
      }
    };

    const tick = async () => {
      try {
        const [windowPosition, scaleFactor, mousePosition] =
          await Promise.all([
            appWindow.outerPosition(),
            appWindow.scaleFactor(),
            cursorPosition(),
          ]);

        /*
         * Convert the global (physical) cursor position into logical
         * coordinates relative to the window's top-left corner.
         */
        const cursorX =
          (mousePosition.x - windowPosition.x) / scaleFactor;
        const cursorY =
          (mousePosition.y - windowPosition.y) / scaleFactor;

        const paddedLeft = cubeLeft - INTERACTIVE_PADDING;
        const paddedTop = cubeTop - INTERACTIVE_PADDING;
        const paddedRight =
          cubeLeft + cubeSize + INTERACTIVE_PADDING;
        const paddedBottom =
          cubeTop + cubeSize + INTERACTIVE_PADDING;

        const isOverCube =
          cursorX >= paddedLeft &&
          cursorX <= paddedRight &&
          cursorY >= paddedTop &&
          cursorY <= paddedBottom;

        const transcriptTop = cubeTop + cubeSize;
        const transcriptBottom = baseHeight + transcriptExtraHeight;

        const isOverTranscript =
          transcriptVisible &&
          cursorX >= 0 &&
          cursorX <= width &&
          cursorY >= transcriptTop &&
          cursorY <= transcriptBottom;

        const shouldIgnore = !(isOverCube || isOverTranscript);

        await applyIgnore(shouldIgnore);
      } catch {
        /*
         * cursorPosition() can transiently fail (e.g. while the
         * cursor is transitioning monitors). Keep the current state.
         */
      }
    };

    /*
     * Start click-through immediately so the transparent area around
     * the cube never blocks the desktop.
     */
    void applyIgnore(true);

    const intervalId = window.setInterval(() => {
      if (!disposed) {
        void tick();
      }
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;

      window.clearInterval(intervalId);

      /*
       * Leave the window click-through when the hook stops, so a
       * hiding/closing Mocu never blocks the desktop.
       */
      void applyIgnore(true);
    };
  }, [
    disabled,
    width,
    baseHeight,
    transcriptExtraHeight,
    cubeLeft,
    cubeTop,
    cubeSize,
    transcriptVisible,
  ]);
}