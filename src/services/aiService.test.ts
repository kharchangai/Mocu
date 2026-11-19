import { afterEach, describe, expect, it, vi } from "vitest";
import { readSettings } from "../store";
import { generateSpeech, transcribeAudio } from "./aiService";

vi.mock("../store", () => ({
  readSettings: vi.fn(),
}));

const mockSettings = {
  apiKey: "test-key",
  gatewayBaseUrl: "https://openrouter.ai/api/v1",
  ttsModel: "heygen/heygen-voice-1-turbo",
  sttModel: "openai/whisper-1",
  ttsVoice: "nadine",
};

describe("generateSpeech", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("retries with pcm when the model only supports pcm and wraps it as WAV", async () => {
    vi.mocked(readSettings).mockResolvedValue(mockSettings as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: 'HeyGen Voice only supports response_format "pcm".', code: 400 } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        new Uint8Array([1, 0, 2, 0]),
        { status: 200, headers: { "content-type": "audio/pcm" } },
      ));
    vi.stubGlobal("fetch", fetchMock);

    const audio = await generateSpeech("Hello there");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).response_format).toBe("mp3");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).response_format).toBe("pcm");
    expect(audio.type).toBe("audio/wav");
    expect(audio.size).toBe(48);
    const wav = new DataView(await audio.arrayBuffer());
    expect(new TextDecoder().decode(await audio.slice(0, 4).arrayBuffer())).toBe("RIFF");
    expect(wav.getUint32(24, true)).toBe(44100);
    expect(wav.getUint32(28, true)).toBe(88200);
  });

  it("uses sample rate and channels reported for PCM audio", async () => {
    vi.mocked(readSettings).mockResolvedValue(mockSettings as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: 'HeyGen Voice only supports response_format "pcm".', code: 400 } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]),
        { status: 200, headers: { "content-type": "audio/pcm;rate=48000;channels=2" } },
      ));
    vi.stubGlobal("fetch", fetchMock);

    const audio = await generateSpeech("Hello there");
    const wav = new DataView(await audio.arrayBuffer());

    expect(wav.getUint16(22, true)).toBe(2);
    expect(wav.getUint32(24, true)).toBe(48000);
    expect(wav.getUint32(28, true)).toBe(192000);
    expect(wav.getUint16(32, true)).toBe(4);
  });

  it("keeps a successful model in the default mp3 format", async () => {
    vi.mocked(readSettings).mockResolvedValue(mockSettings as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      new Uint8Array([1, 2, 3]),
      { status: 200, headers: { "content-type": "audio/mpeg" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const audio = await generateSpeech("Hello there");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audio.type).toBe("audio/mpeg");
    expect(audio.size).toBe(3);
  });
});

describe("transcribeAudio streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("streams transcript deltas when the gateway supports it", async () => {
    vi.mocked(readSettings).mockResolvedValue(mockSettings as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      [
        'event: transcript.text.delta\ndata: {"type":"transcript.text.delta","delta":"hello "}\n\n',
        'event: transcript.text.delta\ndata: {"type":"transcript.text.delta","delta":"there"}\n\n',
        'event: transcript.text.done\ndata: {"type":"transcript.text.done","text":"hello there"}\n\n',
        'data: [DONE]\n\n',
      ].join(""),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    const text = await transcribeAudio(new Blob(["audio"], { type: "audio/webm" }), undefined, (delta) => {
      deltas.push(delta);
    });

    expect(text).toBe("hello there");
    expect(deltas).toEqual(["hello ", "there"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("stream")).toBe("true");
  });

  it("retries once without streaming when the gateway explicitly rejects it", async () => {
    vi.mocked(readSettings).mockResolvedValue(mockSettings as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: "This model does not support the stream option." } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ text: "fallback transcript" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);
    const onDelta = vi.fn();

    const text = await transcribeAudio(new Blob(["audio"], { type: "audio/webm" }), undefined, onDelta);

    expect(text).toBe("fallback transcript");
    expect(onDelta).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("stream")).toBe("true");
    expect((fetchMock.mock.calls[1][1]?.body as FormData).get("stream")).toBeNull();
  });
});