import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import { readSettings } from "../../../store";
import { getChatIdFromConfig } from "../../../chat/services/toolActivity";

export type GeneratedVideoResult = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
};

function createId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const generateVideoTool = tool(
  async ({ prompt, duration, size, frame_images }, config: RunnableConfig): Promise<string> => {
    const signal = config?.signal;
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const settings = await readSettings();
    if (!settings.apiKey) throw new Error("Video generation requires an API key. Configure one in Settings.");

    const body: Record<string, unknown> = { model: settings.videoModel, prompt };
    if (duration !== undefined) body.duration = duration;
    if (size) body.size = size;
    if (frame_images?.length) body.frame_images = frame_images;

    const baseUrl = (settings.gatewayBaseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const response = await tauriFetch(`${baseUrl}/videos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1500);
      throw new Error(`Video generation request failed (${response.status}): ${detail || response.statusText || "No error details returned."}`);
    }
    const job = await response.json() as { id?: string; polling_url?: string; error?: string | { message?: string } };
    if (!job.polling_url) {
      const reason = typeof job.error === "string" ? job.error : job.error?.message;
      throw new Error(`The video provider returned no polling URL.${reason ? ` ${reason}` : ""}`);
    }
    const pollingUrl = new URL(job.polling_url, `${baseUrl}/`).toString();

    let urls: string[] = [];
    let lastStatus = "";
    while (true) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      const pollResponse = await tauriFetch(pollingUrl, {
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        signal,
      });
      if (!pollResponse.ok) {
        const detail = (await pollResponse.text()).slice(0, 1500);
        throw new Error(`Video generation status check failed (${pollResponse.status}): ${detail || pollResponse.statusText || "No error details returned."}`);
      }
      const status = await pollResponse.json() as {
        status?: string;
        unsigned_urls?: string[];
        error?: string | { message?: string };
      };
      if (status.status !== lastStatus) {
        lastStatus = status.status ?? "unknown";
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mocu_video_generation_progress", {
          detail: { chatId: getChatIdFromConfig(config), status: lastStatus },
        }));
      }
      if (status.status === "completed") {
        urls = status.unsigned_urls ?? [];
        break;
      }
      if (status.status === "failed") {
        const reason = typeof status.error === "string" ? status.error : status.error?.message;
        throw new Error(`Video generation failed: ${reason || "Unknown error"}`);
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, 5000);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    if (!urls.length) throw new Error("The video provider completed without returning a video URL.");

    // OpenRouter's unsigned content URLs are still protected by the API key.
    // Only send credentials to the configured API origin; external storage URLs
    // (such as signed CDN links) should be fetched without the key.
    const downloadUrl = new URL(urls[0], `${baseUrl}/`);
    const downloadHeaders = downloadUrl.origin === new URL(baseUrl).origin
      ? { Authorization: `Bearer ${settings.apiKey}` }
      : undefined;
    const videoResponse = await tauriFetch(downloadUrl.toString(), {
      ...(downloadHeaders ? { headers: downloadHeaders } : {}),
      signal,
    });
    if (!videoResponse.ok) {
      const detail = (await videoResponse.text()).slice(0, 1000);
      throw new Error(`Video generation completed (job ${job.id ?? "unknown"}), but the video download failed (${videoResponse.status}): ${detail || videoResponse.statusText || "No error details returned."}. The generation may already have been charged; do not submit another generation until checking whether this job can be retrieved.`);
    }
    const responseMimeType = videoResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    const mimeType = responseMimeType.startsWith("video/") ? responseMimeType : "video/mp4";
    const bytes = new Uint8Array(await videoResponse.arrayBuffer());
    if (!bytes.length) throw new Error("The video provider returned an empty video file.");
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

    const id = createId();
    const extension = mimeType === "video/webm" ? "webm" : mimeType === "video/quicktime" ? "mov" : "mp4";
    const name = `mocu-video-${id.slice(0, 8)}.${extension}`;
    const folder = await join(await appDataDir(), "generated-videos");
    await mkdir(folder, { recursive: true });
    const path = await join(folder, name);
    await writeFile(path, bytes);
    const video: GeneratedVideoResult = { id, name, mimeType, path };
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mocu_generated_video", {
      detail: { ...video, chatId: getChatIdFromConfig(config) },
    }));

    const displayMarkdown = `![Generated video](mocu-generated-video:${id})`;
    return JSON.stringify({
      job_id: job.id,
      name,
      path,
      prompt,
      display_markdown: displayMarkdown,
      message: "Video generated, downloaded, and saved. Include display_markdown exactly in your final answer to show an inline playable video. The chat card also has a button to reveal the video file in its folder.",
    });
  },
  {
    name: "generate_video",
    description: "Generate a video from a text prompt, optionally using attached chat images as the first frame. Supports duration in seconds (model-dependent) and size such as 854x480. The video is generated asynchronously, downloaded, and saved locally. Include the returned display_markdown exactly in your final answer to render an inline video player; the player has controls and an option to reveal the saved file in its folder.",
    schema: z.object({
      prompt: z.string().min(1).describe("Detailed description of the video to generate, including action, camera, mood, and composition."),
      duration: z.number().int().min(1).max(30).optional().describe("Video duration in seconds, subject to model limits."),
      size: z.string().regex(/^\d{3,4}x\d{3,4}$/).optional().describe("Output size, for example 854x480."),
      frame_images: z.array(z.object({
        type: z.literal("image_url"),
        image_url: z.object({ url: z.string().min(1) }),
        frame_type: z.enum(["first_frame", "last_frame"]),
      })).optional().describe("Optional reference image URLs/data URLs with their first_frame or last_frame role. Images attached to the current chat are automatically used as the first frame when this is omitted."),
    }),
  },
);
