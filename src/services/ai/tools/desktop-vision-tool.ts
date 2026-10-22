import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { readSettings } from "../../../store";
import { isAbortError } from "../agent/abort";

type DesktopCapture = {
  imageDataUrl: string;
  screenshotWidth: number;
  screenshotHeight: number;
  monitor: {
    x: number;
    y: number;
    width: number;
    height: number;
    reportedWidth: number;
    reportedHeight: number;
    scaleFactor: number;
    isPrimary: boolean;
  };
};

export const desktopVisionTool = tool(
  async ({ userRequest }, config: RunnableConfig) => {
    const signal = config?.signal;

    try {
      const settings = await readSettings();
      const apiKey = settings.visionApiKey || settings.apiKey;
      const baseURL = settings.visionBaseUrl || settings.mediumBaseUrl;
      const modelName = settings.visionModel || settings.mediumModel;
      if (!apiKey) {
        return "Error: No API Key configured. Please set your API Key in the settings menu.";
      }

      const capture = await invoke<DesktopCapture>("capture_desktop");
      if (!capture?.imageDataUrl || !capture.screenshotWidth || !capture.screenshotHeight) {
        return "Failed to capture the desktop screenshot or its dimensions.";
      }

      const visionLlm = new ChatOpenAI({
        model: modelName,
        apiKey,
        configuration: { baseURL: baseURL || undefined },
      });
      const monitor = capture.monitor;
      const coordinateGuide = monitor
        ? `Capture metadata (authoritative): screenshot pixel size ${capture.screenshotWidth}x${capture.screenshotHeight}; monitor virtual-desktop origin (${monitor.x},${monitor.y}), desktop-coordinate size ${monitor.width}x${monitor.height}; display-reported size ${monitor.reportedWidth}x${monitor.reportedHeight}; display scale factor ${monitor.scaleFactor}; primary monitor=${monitor.isPrimary}. The image is the entire primary monitor, not a cropped application window. Map screenshot pixels (sx, sy) to desktop mouse pixels with x = monitor.x + round(sx * monitor.width / ${capture.screenshotWidth}), y = monitor.y + round(sy * monitor.height / ${capture.screenshotHeight}). Coordinates are zero-based; keep coordinates within the monitor bounds. Return desktop coordinates, not screenshot-relative coordinates, for mouse interaction.`
        : `Screenshot pixel size ${capture.screenshotWidth}x${capture.screenshotHeight}. Monitor origin and bounds are unavailable, so report screenshot-relative coordinates only and clearly mark desktop coordinates unavailable.`;

      const response = await visionLlm.invoke(
        [
          new HumanMessage({
            content: [
              {
                type: "text",
                text: `You are looking at the user's screen. Analyze the supplied full-monitor screenshot and answer the request in English.\n\n${coordinateGuide}\n\nUser request: ${userRequest}\n\nIf asked to locate a visible element, identify it by its visible label/appearance and provide its center point. Clearly label screenshot-relative pixels and desktop mouse pixels separately. Never guess if the target is missing, obscured, ambiguous, or too small; say so. If requested, return a concise JSON object with target, screenshot coordinates, desktop coordinates, monitor bounds, screenshot size, and status. Do not claim to click or move the mouse; this tool only captures and analyzes.`,
              },
              {
                type: "image_url",
                image_url: { url: capture.imageDataUrl },
              },
            ],
          }),
        ],
        { signal },
      );

      return typeof response.content === "string"
        ? response.content
        : Array.isArray(response.content)
          ? response.content.map((item) => (typeof item === "string" ? item : (item as any).text || "")).join(" ")
          : JSON.stringify(response.content);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) {
        throw error;
      }
      console.error("[Vision Tool Error]:", error);
      return `Error capturing or analyzing the desktop screenshot: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "desktop_vision_action",
    description: "Captures and analyzes the full primary monitor screenshot. For coordinates, it provides screenshot pixel dimensions and monitor desktop-coordinate bounds so screenshot points can be mapped to desktop mouse pixels. This tool does not move or click the mouse.",
    schema: z.object({
      userRequest: z.string().describe("The target element or screen question, plus whether to return coordinates or perform a mouse action afterward."),
    }),
  },
);
