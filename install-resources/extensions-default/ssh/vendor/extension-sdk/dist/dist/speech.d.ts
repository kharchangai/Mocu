import type { SttTranscribeParams, SttTranscribeResult, TtsSpeakParams, TtsSpeakResult } from "@mocu/extension-contracts";
import { JsonRpcProtocolClient } from "./protocol-client.js";
/**
 * Lets an extension transcribe audio to text and synthesize text to speech
 * with the STT/TTS models the user configured in Mocu Settings (gateway,
 * API key, models, and voice) — no separate API key needed.
 */
export declare class SpeechApi {
    private readonly client;
    constructor(client: JsonRpcProtocolClient);
    /** Transcribe base64-encoded audio into text. */
    transcribe(params: SttTranscribeParams): Promise<SttTranscribeResult>;
    /** Synthesize text into base64-encoded speech audio. */
    speak(params: TtsSpeakParams): Promise<TtsSpeakResult>;
}
export default SpeechApi;
//# sourceMappingURL=speech.d.ts.map