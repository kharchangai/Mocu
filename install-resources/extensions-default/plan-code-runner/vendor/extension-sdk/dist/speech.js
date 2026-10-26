import { STT_TRANSCRIBE_METHOD, TTS_SPEAK_METHOD } from "@mocu/extension-contracts";
const MAX_SPEECH_TEXT_LENGTH = 20_000;
const MAX_STT_AUDIO_BASE64_LENGTH = 40_000_000; // ~30 MB raw audio
/**
 * Lets an extension transcribe audio to text and synthesize text to speech
 * with the STT/TTS models the user configured in Mocu Settings (gateway,
 * API key, models, and voice) — no separate API key needed.
 */
export class SpeechApi {
    client;
    constructor(client) {
        this.client = client;
    }
    /** Transcribe base64-encoded audio into text. */
    async transcribe(params) {
        if (!params || typeof params.audio !== "string" || !params.audio.trim()) {
            throw new Error("Speech transcribe requires a non-empty base64 'audio' string.");
        }
        const payload = {
            audio: params.audio,
            ...(typeof params.mimeType === "string" && params.mimeType.trim()
                ? { mimeType: params.mimeType.trim() }
                : {}),
        };
        return this.client.request(STT_TRANSCRIBE_METHOD, payload);
    }
    /** Synthesize text into base64-encoded speech audio. */
    async speak(params) {
        if (!params || typeof params.text !== "string" || !params.text.trim()) {
            throw new Error("Speech speak requires a non-empty 'text' string.");
        }
        const text = params.text;
        if (text.length > MAX_SPEECH_TEXT_LENGTH) {
            throw new Error(`Speech speak text is too long (maximum ${MAX_SPEECH_TEXT_LENGTH} characters per call).`);
        }
        return this.client.request(TTS_SPEAK_METHOD, { text });
    }
}
export default SpeechApi;
//# sourceMappingURL=speech.js.map