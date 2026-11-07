import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  createJavaScriptDemoReference,
  saveJavaScriptDemo,
} from "../../../chat/services/javascriptDemoRegistry";

export function createJavaScriptDemoTool(projectPath = "") {
  return tool(
    async ({ title, javascript, source, code, sourceCode, javascriptCode, javascript_source, source_code, js, demoCode, css, height, savedDemoReference }) => {
      if (savedDemoReference) return savedDemoReference;
      const demoSource = javascript ?? source ?? code ?? sourceCode ?? javascriptCode ?? javascript_source ?? source_code ?? js ?? demoCode;
      if (!demoSource?.trim()) {
        return "No JavaScript source or saved demo reference was provided. Retry run_javascript_demo with the complete source in the javascript field; do not return a mocu-js block without a saved reference.";
      }
      const id = await saveJavaScriptDemo({
        title: title?.trim() || "Interactive JavaScript",
        javascript: demoSource,
        css: css ?? "",
        height: height ?? 360,
      }, projectPath);
      return createJavaScriptDemoReference(id);
    },
    {
      name: "run_javascript_demo",
      description:
        "Compatibility/recovery only: do not call this tool to create a new interactive preview. For a new preview, write the complete runnable JavaScript directly inside a `mocu-js` fenced block in your response; Mocu automatically saves that source to a persistent project/global file and replaces it with the returned reference before display. Never expose the source or a filesystem path to the user. Each independent preview gets its own 360px-high block with no internal vertical scrolling, using Mocu warm-neutral colors (#ffffff/#f7f7f5 surfaces, #30302e text, #73736f secondary, #e7e7e3 borders, restrained #4d645d green); the sandbox provides `root` and network access is unavailable. Ordinary code-only requests should use a normal JavaScript fence. This tool remains only for resuming legacy saved calls; never invent references.",
      schema: z.object({
        savedDemoReference: z.string().regex(/^mocu-interactive-js:[A-Za-z0-9-]+$/).optional()
          .describe("Opaque reference to an already saved preview, used only when resuming a saved tool call."),
        title: z.string().trim().max(120).optional()
          .describe("Short accessible title for the preview; the UI header remains Interactive JavaScript."),
        javascript: z.string().max(30_000).optional()
          .describe("Complete JavaScript source to persist and execute in the isolated preview. It receives an HTMLElement parameter named root."),
        source: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        code: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        sourceCode: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        javascript_source: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        source_code: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        js: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        javascriptCode: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        demoCode: z.string().max(30_000).optional()
          .describe("Compatibility alias for javascript source; prefer the javascript field."),
        css: z.string().max(12_000).optional()
          .describe("Optional CSS persisted with the source and applied only inside the isolated preview."),
        height: z.number().int().min(200).max(720).optional()
          .describe("Optional preview height in pixels (200–720); defaults to 360."),
      }),
    },
  );
}

/** Global-scope tool used by ordinary chats. */
export const javascriptDemoTool = createJavaScriptDemoTool();
