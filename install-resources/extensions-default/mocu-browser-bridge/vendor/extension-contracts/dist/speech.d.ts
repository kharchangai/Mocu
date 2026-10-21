export declare const STT_TRANSCRIBE_METHOD: "mocu.stt.transcribe";
export interface SttTranscribeParams {
    /** Audio payload encoded as base64 (e.g. wav / mp3 / ogg / webm). */
    audio: string;
    /**
     * Optional MIME type of the audio payload. Defaults to "audio/webm"
     * on the host when omitted.
     */
    mimeType?: string;
}
export interface SttTranscribeResult {
    /** Transcribed text, in the user's configured STT model language. */
    text: string;
}
export declare const TTS_SPEAK_METHOD: "mocu.tts.speak";
export interface TtsSpeakParams {
    /** Text to synthesize with the user's configured TTS model and voice. */
    text: string;
}
export interface TtsSpeakResult {
    /** Synthesized speech encoded as base64. */
    audio: string;
    /** MIME type of the synthesized audio (e.g. "audio/mpeg"). */
    mimeType: string;
}
//# sourceMappingURL=speech.d.ts.map