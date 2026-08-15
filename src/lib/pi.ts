import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type PiEvent =
  | {
      type: "ready";
      pid: number;
    }
  | {
      type: "prompt_start";
      requestId: string;
    }
  | {
      type: "text_delta";
      requestId: string | null;
      delta: string;
    }
  | {
      type: "message_end";
      requestId: string | null;
      usage: unknown;
      stopReason: string | null;
      responseId: string | null;
    }
  | {
      type: "turn_end";
      requestId: string | null;
      toolResults: unknown[];
    }
  | {
      type: "prompt_complete";
      requestId: string;
    }
  | {
      type: "pong";
      requestId: string | null;
    }
  | {
      type: "error";
      requestId: string | null;
      code: string;
      message: string;
    }
  | {
      type: "fatal_error";
      requestId: null;
      message: string;
    }
  | {
      type: "closed";
    };

let removeListener: UnlistenFn | null = null;
let initializationPromise: Promise<void> | null = null;

export function initializePi(
  onEvent: (event: PiEvent) => void,
): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    removeListener = await listen<PiEvent>("pi-event", (event) => {
      onEvent(event.payload);
    });

    await invoke("start_pi");
  })();

  return initializationPromise;
}

export async function sendPrompt(message: string): Promise<string> {
  const requestId = crypto.randomUUID();

  await invoke("prompt_pi", {
    requestId,
    message,
  });

  return requestId;
}

export async function pingPi(): Promise<string> {
  const requestId = crypto.randomUUID();

  await invoke("ping_pi", {
    requestId,
  });

  return requestId;
}

export async function stopPi(): Promise<void> {
  await invoke("stop_pi");

  removeListener?.();
  removeListener = null;
  initializationPromise = null;
}