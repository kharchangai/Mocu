import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  httpFetch: vi.fn(),
  readSettings: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.httpFetch }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:\\AppData"),
  join: vi.fn(async (...parts: string[]) => parts.join("\\")),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ mkdir: mocks.mkdir, writeFile: mocks.writeFile }));
vi.mock("../../../store", () => ({ readSettings: mocks.readSettings }));

import { generateVideoTool } from "./generate-video-tool";

const settings = {
  apiKey: "test-openrouter-key",
  gatewayBaseUrl: "https://openrouter.ai/api/v1",
  videoModel: "tbc/mischief-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSettings.mockResolvedValue(settings);
  mocks.mkdir.mockResolvedValue(undefined);
  mocks.writeFile.mockResolvedValue(undefined);
});

describe("generate_video", () => {
  it("submits the documented request, polls, downloads the unsigned URL, and saves the video", async () => {
    const frame = {
      type: "image_url" as const,
      image_url: { url: "data:image/png;base64,AA==" },
      frame_type: "first_frame" as const,
    };
    mocks.httpFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-123", polling_url: "/api/v1/videos/job-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", unsigned_urls: ["https://cdn.example/video.mp4"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }));

    const raw = await generateVideoTool.invoke({ prompt: "A cheerful animation", duration: 5, size: "854x480", frame_images: [frame] });
    const result = JSON.parse(raw);

    expect(mocks.httpFetch).toHaveBeenCalledTimes(3);
    const [submitUrl, submitInit] = mocks.httpFetch.mock.calls[0] as [string, RequestInit];
    expect(submitUrl).toBe("https://openrouter.ai/api/v1/videos");
    expect(submitInit.method).toBe("POST");
    expect(submitInit.headers).toMatchObject({ Authorization: "Bearer test-openrouter-key" });
    expect(JSON.parse(String(submitInit.body))).toEqual({
      model: "tbc/mischief-1",
      prompt: "A cheerful animation",
      duration: 5,
      size: "854x480",
      frame_images: [frame],
    });

    const [pollUrl, pollInit] = mocks.httpFetch.mock.calls[1] as [string, RequestInit];
    expect(pollUrl).toBe("https://openrouter.ai/api/v1/videos/job-123");
    expect(pollInit.headers).toMatchObject({ Authorization: "Bearer test-openrouter-key" });
    expect(mocks.httpFetch.mock.calls[2]?.[0]).toBe("https://cdn.example/video.mp4");
    expect(mocks.mkdir).toHaveBeenCalledWith("C:\\AppData\\generated-videos", { recursive: true });
    expect(mocks.writeFile).toHaveBeenCalledOnce();
    expect((mocks.writeFile.mock.calls[0] as [string, Uint8Array])[1]).toEqual(new Uint8Array([0, 1, 2, 3]));
    expect(result).toMatchObject({ job_id: "job-123", prompt: "A cheerful animation" });
    expect(result.path).toMatch(/generated-videos\\mocu-video-[^\\]+\.mp4$/);
    expect(result.display_markdown).toBe(`![Generated video](mocu-generated-video:${result.display_markdown.match(/mocu-generated-video:(.+)\)$/)?.[1]})`);
  });

  it("authenticates downloads from the configured API origin", async () => {
    mocks.httpFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-123", polling_url: "/api/v1/videos/job-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", unsigned_urls: ["https://openrouter.ai/api/v1/videos/job-123/content?index=0"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }));

    await generateVideoTool.invoke({ prompt: "A test clip" });

    const [downloadUrl, downloadInit] = mocks.httpFetch.mock.calls[2] as [string, RequestInit];
    expect(downloadUrl).toBe("https://openrouter.ai/api/v1/videos/job-123/content?index=0");
    expect(downloadInit.headers).toMatchObject({ Authorization: "Bearer test-openrouter-key" });
  });

  it("does not send the API key to external video storage URLs", async () => {
    mocks.httpFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-123", polling_url: "/api/v1/videos/job-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", unsigned_urls: ["https://cdn.example/video.mp4"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0, 1, 2]), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }));

    await generateVideoTool.invoke({ prompt: "A test clip" });

    const [, downloadInit] = mocks.httpFetch.mock.calls[2] as [string, RequestInit];
    expect(downloadInit.headers).toBeUndefined();
  });

  it("preserves the job ID in download errors to discourage duplicate paid generations", async () => {
    mocks.httpFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-123", polling_url: "/api/v1/videos/job-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", unsigned_urls: ["https://openrouter.ai/api/v1/videos/job-123/content?index=0"] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Failed to authenticate request with Clerk" } }), { status: 401 }));

    await expect(generateVideoTool.invoke({ prompt: "A test clip" })).rejects.toThrow(
      /generation completed \(job job-123\), but the video download failed \(401\).*may already have been charged/i,
    );
  });

  it("reports the provider's failed job reason without attempting a download", async () => {
    mocks.httpFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-123", polling_url: "https://openrouter.ai/api/v1/videos/job-123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "failed", error: { message: "Unsupported duration" } }), { status: 200 }));

    await expect(generateVideoTool.invoke({ prompt: "A test clip" })).rejects.toThrow("Video generation failed: Unsupported duration");
    expect(mocks.httpFetch).toHaveBeenCalledTimes(2);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("includes response details when the initial request is rejected", async () => {
    mocks.httpFetch.mockResolvedValueOnce(new Response("invalid model", { status: 400, statusText: "Bad Request" }));

    await expect(generateVideoTool.invoke({ prompt: "A test clip" })).rejects.toThrow("Video generation request failed (400): invalid model");
  });
});
