// Voice Test App - Mocu extension backend
// Provides two commands used by the in-app UI:
//   transcribe: audio (base64) -> text  (STT via Mocu host)
//   speak:      text -> audio (base64)  (TTS via Mocu host)
// Speech uses the STT/TTS models configured by the user in Mocu Settings;
// no extra manifest permission is required.

import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    // input: { audio: base64String, mimeType?: string }
    async transcribe(input) {
      const audio = input && typeof input.audio === "string" ? input.audio : "";
      if (!audio.trim()) {
        throw new Error("No audio data was provided.");
      }
      const mimeType =
        input && typeof input.mimeType === "string" && input.mimeType.trim()
          ? input.mimeType.trim()
          : undefined;

      const transcription = await extension.speech.transcribe(
        mimeType ? { audio, mimeType } : { audio },
      );

      return { text: transcription.text };
    },

    // input: { text: string }
    async speak(input) {
      const text = input && typeof input.text === "string" ? input.text : "";
      if (!text.trim()) {
        throw new Error("Input text is empty.");
      }

      const speech = await extension.speech.speak({ text });

      return { audio: speech.audio, mimeType: speech.mimeType };
    },
  },
});

extension.start();
