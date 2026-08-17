// src/components/StatusBubble.tsx
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MocuState } from './Mocu';
import {
  AgentStatusIcon,
  getStatusAccent,
} from './AgentStatusVisuals';

interface StatusBubbleProps {
  state: MocuState;
}

export const StatusBubble: React.FC<StatusBubbleProps> = ({ state }) => {
  const [activeActivity, setActiveActivity] = useState<string | null>(null);

  useEffect(() => {
    const handleActivity = (event: Event) => {
      const customEvent = event as CustomEvent<string | null>;
      setActiveActivity(customEvent.detail);
    };

    window.addEventListener('mocu_activity', handleActivity);
    return () => {
      window.removeEventListener('mocu_activity', handleActivity);
    };
  }, []);

  const currentVisualState = activeActivity || state;

  // Hide the bubble completely if state is 'idle' or 'typing'
  if (currentVisualState === 'idle' || currentVisualState === 'typing') return null;

  const accent = getStatusAccent(currentVisualState);

  return (
    // Positioned relative to the parent anchor (the cube wrapper in Mocu.tsx),
    // not the outer container, so it stays visually attached to the head.
    <div className="absolute -top-[52px] left-0 right-0 flex justify-center z-50 pointer-events-none overflow-visible">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentVisualState}
          initial={{ opacity: 0, y: 16, scale: 0.5, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: -14, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 16, scale: 0.5, filter: 'blur(6px)' }}
          transition={{ type: "spring", stiffness: 340, damping: 26, mass: 0.8 }}
          className="relative flex items-center justify-center"
        >
          {/* Soft connector stem fading down into Mocu's head */}
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-2.5 h-6
                          bg-gradient-to-b from-slate-900/50 to-transparent
                          rounded-full blur-[1px] -z-10" />

          {/* Ambient breathing glow (color reacts to the active tool)
              Fixed: shrunk to match the box size (w-12 h-12) and reduced blur
              (blur-xl instead of blur-2xl) so it no longer overflows and gets
              clipped at the top of the container. */}
          <motion.div
            animate={{ opacity: [0.2, 0.45, 0.2], scale: [0.9, 1.08, 0.9] }}
            transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
            className="absolute w-12 h-12 rounded-full blur-xl pointer-events-none"
            style={{ backgroundColor: accent, opacity: 0.32 }}
          />

          {/* Outer capsule with an animated gradient ring border */}
          <div className="relative w-12 h-12 rounded-2xl overflow-hidden">
            {/* Rotating conic gradient acting as a living border */}
            <motion.div
              className="absolute inset-0"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 3.5, ease: "linear" }}
              style={{
                background: `conic-gradient(from 0deg, transparent 0%, ${accent} 30%, transparent 55%)`,
              }}
            />

            {/* Inner frosted glass body (creates a thin ring effect via inset) */}
            <div className="absolute inset-[1.5px] rounded-[14px]
                            bg-slate-950/85 backdrop-blur-2xl
                            flex items-center justify-center overflow-hidden
                            shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              {/* Subtle top sheen for a glass feel */}
              <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.08] to-transparent pointer-events-none" />
              <div className="relative z-10">
                <AgentStatusIcon state={currentVisualState} />
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};