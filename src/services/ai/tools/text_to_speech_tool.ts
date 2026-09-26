import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { generateSpeech } from "../../aiService";
import { readSettings } from "../../../store";

/**
 * Text-to-Speech tools for the Mocu agent.
 *
 * Uses the TTS model and voice the user configured in Settings
 * (MOCU_TTS_MODEL / MOCU_TTS_VOICE) through the same generateSpeech()
 * pipeline the Mocu avatar uses, so the agent speaks with the exact
 * same voice as the avatar.
 *
 * Two tools are exposed:
 * - text_to_speech : generate speech with the configured TTS model and play it
 * - speech_control : stop current playback or show the configured speech setup
 */

const MAX_CHUNK_LENGTH = 2_000;
const PLAYBACK_TIMEOUT_MS = 300_000;

export type SpeechChunkOptions = {
  maxLength?: number;
};

/**
 * Splits text into speakable chunks so very long texts are sent to the
 * TTS model in safe pieces. Splits on sentence boundaries when possible.
 */
export const splitIntoSpeechChunks = (
  text: string,
  options: SpeechChunkOptions = {},
): string[] => {
  const maxLength = Math.max(40, options.maxLength ?? MAX_CHUNK_LENGTH);
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentences = normalized.match(/[^.!?…\n]+[.!?…]*\s*/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const rawSentence of sentences) {
    let sentence = rawSentence.trim();

    if (!sentence) {
      continue;
    }

    // Hard-split sentences that are longer than the allowed chunk size.
    while (sentence.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }

      chunks.push(sentence.slice(0, maxLength));
      sentence = sentence.slice(maxLength).trim();
    }

    if (!sentence) {
      continue;
    }

    if (current && current.length + 1 + sentence.length > maxLength) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
};

/*
 * Playback state shared between text_to_speech and speech_control so
 * the agent can stop speech it started earlier.
 */
let currentAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

const stopCurrentPlayback = (): void => {
  const audio = currentAudio;
  const objectUrl = currentObjectUrl;

  currentAudio = null;
  currentObjectUrl = null;

  if (audio) {
    audio.onended = null;
    audio.onerror = null;

    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // The element may already be detached; nothing else to clean up.
    }
  }

  if (objectUrl) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Revoking an already-revoked URL is harmless.
    }
  }
};

const playSpeechBlob = (
  blob: Blob,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (typeof Audio === "undefined" || typeof URL === "undefined") {
      reject(
        new Error("Audio playback is not available in this environment."),
      );
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);

    currentAudio = audio;
    currentObjectUrl = objectUrl;

    const timer = setTimeout(() => {
      cleanUp();
      stopCurrentPlayback();
      reject(new Error("Speech playback timed out."));
    }, PLAYBACK_TIMEOUT_MS);

    const cleanUp = () => {
      clearTimeout(timer);
      audio.onended = null;
      audio.onerror = null;

      if (currentAudio === audio) {
        currentAudio = null;
      }

      if (currentObjectUrl === objectUrl) {
        currentObjectUrl = null;
        URL.revokeObjectURL(objectUrl);
      }
    };

    audio.onended = () => {
      cleanUp();
      resolve();
    };

    audio.onerror = () => {
      cleanUp();
      reject(new Error("Speech playback failed in the audio player."));
    };

    void audio.play().catch((error: unknown) => {
      cleanUp();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

export type SpeakTextInput = {
  text: string;
  wait?: boolean;
  interrupt?: boolean;
};

const speakText = async (
  input: SpeakTextInput,
  signal?: AbortSignal,
): Promise<string> => {
  const chunks = splitIntoSpeechChunks(input.text);

  if (chunks.length === 0) {
    return "Error: text_to_speech requires a non-empty text to speak.";
  }

  const shouldWait = input.wait ?? true;
  const shouldInterrupt = input.interrupt ?? true;

  if (shouldInterrupt) {
    stopCurrentPlayback();
  }

  const spokenLength = input.text.trim().length;
  const summary = `Spoke ${spokenLength} characters using the TTS model configured in Settings.`;

  const run = async (): Promise<void> => {
    for (const chunk of chunks) {
      /*
       * Same pipeline as the Mocu avatar: generateSpeech() reads the
       * TTS model, voice, base URL, and API key from Settings.
       */
      const speechBlob = await generateSpeech(chunk, signal);
      await playSpeechBlob(speechBlob);
    }
  };

  if (!shouldWait) {
    void run().catch((error: unknown) => {
      console.warn("[TTS] Background speech failed:", error);
    });

    return `Speech started in the background without waiting. ${summary}`;
  }

  try {
    await run();
    return summary;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
};

/**
 * text_to_speech: speaks text with the TTS model chosen in Settings.
 */
export const textToSpeechTool = tool(
  async (input: SpeakTextInput) => {
    console.log(`[TTS Tool] Speaking text (${input.text.trim().length} chars).`);
    return speakText(input);
  },
  {
    name: "text_to_speech",
    description:
      "Speaks text out loud using the TTS model and voice the user configured in Settings " +
      "(the same voice as the Mocu avatar). Use it whenever the user asks you to say something, " +
      "speak, talk, or read text aloud.",
    schema: z.object({
      text: z.string().min(1).describe("The text to speak out loud."),
      wait: z
        .boolean()
        .optional()
        .describe(
          "If true (default), wait until the speech finishes before continuing. If false, start speech and continue immediately.",
        ),
      interrupt: z
        .boolean()
        .optional()
        .describe(
          "If true (default), stop any currently playing speech before speaking this text.",
        ),
    }),
  },
);

/**
 * speech_control: stops playback or reports the configured speech setup.
 */
export const speechControlTool = tool(
  async ({ action }: { action: "stop" | "status" }) => {
    if (action === "stop") {
      stopCurrentPlayback();
      return "All current speech playback has been stopped.";
    }

    const settings = await readSettings();
    const ttsModel = settings.ttsModel?.trim() || "";
    const ttsVoice = settings.ttsVoice?.trim() || "";
    const speechBaseUrl = settings.expensiveBaseUrl?.trim() || "";

    if (!ttsModel || !ttsVoice) {
      return "No TTS model is configured. The user can pick a TTS model and voice in Settings.";
    }

    return [
      "Speech is configured in Settings:",
      `- TTS model: ${ttsModel}`,
      `- TTS voice: ${ttsVoice}`,
      speechBaseUrl ? `- Speech base URL: ${speechBaseUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
  {
    name: "speech_control",
    description:
      "Controls speech playback: stop the currently playing speech, or show the TTS model and voice configured in Settings.",
    schema: z.object({
      action: z
        .enum(["stop", "status"])
        .describe(
          "'stop' cancels current speech playback, 'status' shows the configured TTS model and voice.",
        ),
    }),
  },
);
