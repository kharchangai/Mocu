// src/chat/services/memoryActivity.ts
//
// Tiny event channel for the background project-memory save.
//
// The project agent saves the finished turn into project memory after
// the response was already sent (saveProjectMemoryInBackground). This
// module lets that background job tell the chat UI when the memory
// save starts and when it completes, so a small mind icon can blink
// while saving and stand still once the save is complete.

export type MemorySaveStatus =
  | 'saving'
  | 'done'
  | 'error';

export type MemorySaveActivity = {
  status: MemorySaveStatus;

  /*
   * The chat conversation the save belongs to. The UI keeps one
   * indicator per chat, so events without a chat id cannot be shown
   * under the correct response.
   */
  chatId?: string;

  projectPath?: string;
};

export const dispatchMemorySaveActivity = (
  activity: MemorySaveActivity,
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MemorySaveActivity>(
      'mocu_memory_save',
      {
        detail: activity,
      },
    ),
  );
};
