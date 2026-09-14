// src/chat/hooks/useMemorySaveStatus.ts
//
// Tracks the background project-memory save status for the chat UI.
//
// The hook lives in ChatBox (always mounted), so it never misses the
// "saving" event that the project agent fires right before its
// response is returned — even though the mind icon itself is only
// rendered below the latest response.

import { useEffect, useState } from 'react';

import type { MemorySaveStatus } from '../services/memoryActivity';

export function useMemorySaveStatus(): MemorySaveStatus | null {
  const [status, setStatus] =
    useState<MemorySaveStatus | null>(
      null,
    );

  useEffect(() => {
    const handleMemorySave = (
      event: Event,
    ) => {
      const activity = (
        event as CustomEvent<{ status: MemorySaveStatus }>
      ).detail;

      if (
        activity?.status === 'saving' ||
        activity?.status === 'done' ||
        activity?.status === 'error'
      ) {
        setStatus(activity.status);
      }
    };

    window.addEventListener(
      'mocu_memory_save',
      handleMemorySave,
    );

    return () => {
      window.removeEventListener(
        'mocu_memory_save',
        handleMemorySave,
      );
    };
  }, []);

  return status;
}
