import { useSyncExternalStore } from 'react';

import type { ExtensionInteractionButton } from '../types/extension-interaction';
import { respondExtension } from './extension-client';

export type ExtensionInteraction = {
  extensionId: string;
  extensionName: string;
  requestId: string | number;
  chatId: string;
  command: string;
  title: string;
  message: string;
  inputEnabled: boolean;
  inputPlaceholder: string;
  buttons: ExtensionInteractionButton[];
  isResponding: boolean;
};

const interactions = new Map<string, ExtensionInteraction>();
const cancelledRequests = new Set<string>();
const listeners = new Set<() => void>();

const requestKey = (
  extensionId: string,
  requestId: string | number,
): string => `${extensionId}:${requestId}`;

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export function setExtensionInteraction(
  interaction: ExtensionInteraction,
): boolean {
  const key = requestKey(interaction.extensionId, interaction.requestId);
  if (cancelledRequests.delete(key)) {
    return false;
  }

  interactions.set(interaction.chatId, interaction);
  notify();
  return true;
}

export function cancelExtensionInteraction(
  extensionId: string,
  requestId: string | number,
): void {
  const key = requestKey(extensionId, requestId);
  let found = false;

  for (const [chatId, interaction] of interactions) {
    if (
      interaction.extensionId === extensionId &&
      interaction.requestId === requestId
    ) {
      interactions.delete(chatId);
      found = true;
      break;
    }
  }

  if (!found) {
    // Cancellation can arrive while the host is still validating/loading the
    // extension manifest; remember it so a late interaction cannot reappear.
    cancelledRequests.add(key);
  }
  notify();
}

export function clearExtensionInteraction(
  extensionId: string,
  requestId: string | number,
): void {
  for (const [chatId, interaction] of interactions) {
    if (
      interaction.extensionId === extensionId &&
      interaction.requestId === requestId
    ) {
      interactions.delete(chatId);
      notify();
      return;
    }
  }
}

export function getExtensionInteraction(
  chatId: string | null | undefined,
): ExtensionInteraction | null {
  return chatId ? interactions.get(chatId) ?? null : null;
}

export function useExtensionInteraction(
  chatId: string | null | undefined,
): ExtensionInteraction | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => getExtensionInteraction(chatId),
    () => null,
  );
}

export async function respondToExtensionInteraction(
  chatId: string,
  response: { actionId: string; input?: string },
): Promise<void> {
  const interaction = interactions.get(chatId);

  if (!interaction) {
    throw new Error('This extension interaction is no longer active.');
  }
  if (interaction.isResponding) {
    throw new Error('A reply is already being sent to the extension.');
  }

  const responding = { ...interaction, isResponding: true };
  interactions.set(chatId, responding);
  notify();

  try {
    await respondExtension(
      interaction.extensionId,
      interaction.requestId,
      response,
      null,
    );

    if (interactions.get(chatId) === responding) {
      interactions.delete(chatId);
      notify();
    }
  } catch (error) {
    if (interactions.get(chatId) === responding) {
      interactions.set(chatId, { ...interaction, isResponding: false });
      notify();
    }
    throw error;
  }
}
