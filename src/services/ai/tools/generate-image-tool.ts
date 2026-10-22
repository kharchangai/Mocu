import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { z } from "zod";
import { readSettings } from "../../../store";
import { getChatIdFromConfig } from "../../../chat/services/toolActivity";
import { getImageInputReferences } from "../agent/image-content";

export type GeneratedImageResult = {
  id: string;
  name: string;
  mimeType: string;
  path: string;
};

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export const generateImageTool = tool(
  async ({ prompt, resolution, aspect_ratio, input_references }, config: RunnableConfig): Promise<string> => {
    const signal = config?.signal;
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

    const settings = await readSettings();
    if (!settings.apiKey) throw new Error("Image generation requires an API key. Configure one in Settings.");

    const body: Record<string, unknown> = { model: settings.imageModel, prompt };
    if (resolution) body.resolution = resolution;
    if (aspect_ratio) body.aspect_ratio = aspect_ratio;
    const attachedReferences = getImageInputReferences(
      config?.configurable?.currentUserMessage as BaseMessage | undefined,
    );
    const references = input_references?.length ? input_references : attachedReferences;
    if (references.length) body.input_references = references;

    const baseUrl = (settings.gatewayBaseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1500);
      throw new Error(`Image generation failed (${response.status}): ${detail}`);
    }

    const payload = await response.json() as {
      data?: Array<{ b64_json?: string; url?: string; mime_type?: string }>;
    };
    const result = payload.data?.[0];
    if (!result) throw new Error("The image provider returned no image.");

    let mimeType = result.mime_type || "image/png";
    let bytes: Uint8Array;
    if (result.b64_json) {
      bytes = decodeBase64(result.b64_json);
    } else if (result.url) {
      const imageResponse = await fetch(result.url, { signal });
      if (!imageResponse.ok) throw new Error(`Could not download the generated image (${imageResponse.status}).`);
      mimeType = imageResponse.headers.get("content-type")?.split(";")[0] || mimeType;
      bytes = new Uint8Array(await imageResponse.arrayBuffer());
    } else {
      throw new Error("The image provider returned an unsupported image response.");
    }

    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const name = `mocu-image-${id.slice(0, 8)}.${extension}`;
    const folder = await join(await appDataDir(), "generated-images");
    await mkdir(folder, { recursive: true });
    const path = await join(folder, name);
    await writeFile(path, bytes);

    const image: GeneratedImageResult = { id, name, mimeType, path };
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("mocu_generated_image", {
        detail: { ...image, chatId: getChatIdFromConfig(config) },
      }));
    }
    return JSON.stringify({ name, path, prompt, message: "Image generated and saved successfully." });
  },
  {
    name: "generate_image",
    description: "Generate an image using the image model configured in Settings. Provide resolution (1K, 2K, or 4K) and aspect_ratio (such as 1:1, 16:9, or 9:16) when requested. Use attached chat images as visual references when relevant, or pass input_references explicitly. The generated image is saved to disk and shown in the chat.",
    schema: z.object({
      prompt: z.string().min(1).describe("A detailed visual description of the image to generate."),
      resolution: z.enum(["1K", "2K", "4K"]).optional().describe("Requested output resolution: 1K, 2K, or 4K."),
      aspect_ratio: z.enum(["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]).optional().describe("Requested output aspect ratio."),
      input_references: z.array(z.object({
        type: z.literal("image_url"),
        image_url: z.object({ url: z.string().min(1) }),
      })).optional().describe("Optional reference images, each using an image_url URL or data URL. Attached chat images are included automatically when this is omitted."),
    }),
  },
);
