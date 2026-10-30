import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { RunnableConfig } from "@langchain/core/runnables";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { generateSpeech } from "../../aiService";
import { readSettings } from "../../../store";
import { getChatIdFromConfig } from "../../../chat/services/toolActivity";

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

export type GeneratedSpeechResult = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
  text: string;
};

const getAudioExtension = (mimeType: string): string => {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("flac")) return "flac";
  return "mp3";
};

const saveSpeech = async (blob: Blob, text: string): Promise<GeneratedSpeechResult> => {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const extension = getAudioExtension(blob.type);
  const name = `mocu-audio-${id.slice(0, 8)}.${extension}`;
  const folder = await join(await appDataDir(), "generated-audio");
  await mkdir(folder, { recursive: true });
  const path = await join(folder, name);
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return { id, name, mimeType: blob.type || "audio/mpeg", path, text };
};

function encodeAudioReference(audio: GeneratedSpeechResult): string {
  const label = audio.text.replace(/[\[\]]/g, "").replace(/\s+/g, " ").trim();
  return `[${label || "Play generated audio"}](mocu-generated-audio:${audio.id})`;
}

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
  autoPlay?: boolean;
  wait?: boolean;
  interrupt?: boolean;
};

const speakText = async (
  input: SpeakTextInput,
  signal?: AbortSignal,
  config?: RunnableConfig,
): Promise<string> => {
  const chunks = splitIntoSpeechChunks(input.text);
  if (chunks.length === 0) return "Error: text_to_speech requires a non-empty text to speak.";

  if (input.interrupt ?? true) stopCurrentPlayback();
  const generated: GeneratedSpeechResult[] = [];
  for (const chunk of chunks) {
    const blob = await generateSpeech(chunk, signal);
    const audio = await saveSpeech(blob, chunk);
    generated.push(audio);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mocu_generated_audio", {
        detail: { ...audio, chatId: getChatIdFromConfig(config) },
      }));
    }
  }

  const playAll = async (): Promise<void> => {
    for (const audio of generated) {
      const bytes = await readFile(audio.path);
      await playSpeechBlob(new Blob([new Uint8Array(bytes)], { type: audio.mimeType }));
    }
  };
  if (input.autoPlay ?? false) {
    if (input.wait ?? true) {
      try {
        await playAll();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return JSON.stringify({ error: message, audios: generated, display_markdown: generated.map(encodeAudioReference).join(" ") });
      }
    } else {
      void playAll().catch((error: unknown) => console.warn("[TTS] Background playback failed:", error));
    }
  }

  return JSON.stringify({
    summary: `Generated ${generated.length} audio clip${generated.length === 1 ? "" : "s"} for ${input.text.trim().length} characters.`,
    audios: generated,
    display_markdown: generated.map(encodeAudioReference).join(" "),
    message: "Speech audio was generated and saved. To render a small replay button beside a word or phrase, add a Markdown link with the matching mocu-generated-audio ID from audios. Use the desired word or phrase as the link label (the ID must remain unchanged). Each clip has its own ID and text; place each clip's link beside the word or phrase it pronounces. Omit audio links when replay controls are not useful.",
  });
};

/**
 * text_to_speech: speaks text with the TTS model chosen in Settings.
 */
export const textToSpeechTool = tool(
  async (input: SpeakTextInput, config: RunnableConfig) => {
    console.log(`[TTS Tool] Speaking text (${input.text.trim().length} chars).`);
    return speakText(input, config?.signal, config);
  },
  {
    name: "text_to_speech",
    description:
      "Generate speech with the TTS model and voice configured in Settings. Each clip is saved and returned with an audio ID. " +
      "Use a Markdown link with href mocu-generated-audio:<ID> and the matching audios.text as the link label beside the word or phrase in your final answer. " +
      "For multiple clips, use each matching ID beside its own pronunciation; omit links when not useful. Audio is not played by default. Set autoPlay to true only when the user should hear it immediately.",
    schema: z.object({
      text: z.string().min(1).describe("The text to synthesize into speech."),
      autoPlay: z
        .boolean()
        .optional()
        .describe("If true, play generated audio immediately. Defaults to false; when false, only generate and save audio for optional replay."),
      wait: z
        .boolean()
        .optional()
        .describe(
          "When autoPlay is true: if true (default), wait until playback finishes before continuing. If false, play in the background and continue immediately. Has no effect when autoPlay is false.",
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
