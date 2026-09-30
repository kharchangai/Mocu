/*
 * write_file tool — pi-style file writing.
 *
 * Creates a new file (and any missing parent folders) with the given
 * text. Refuses to overwrite an existing file unless overwrite=true, so
 * the agent cannot silently destroy content it has not read.
 */
import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { isAbortError, throwIfAborted } from "../../agent/abort";

import {
  splitLines,
  formatNumberedLines,
} from "./line-utils";
import {
  fileExists,
  resolveAbsolutePath,
  utf8ByteLength,
  writeText,
} from "./fs-adapter";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const writeFileInputSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Absolute path of the file to create, e.g. 'E:\\\\project\\\\src\\\\notes.md'.",
    ),

  content: z
    .string()
    .describe(
      "Full text content to write into the file. Use '\\n' for new lines.",
    ),

  overwrite: z
    .boolean()
    .optional()
    .describe(
      "Set true to replace an existing file. Omit (or false) to only create new files.",
    ),
});

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

export const writeFileTool = tool(
  async ({ path, content, overwrite }, config: RunnableConfig) => {
    const signal = config?.signal;

    try {
      throwIfAborted(signal);

      const filePath = await resolveAbsolutePath(path);

      if (utf8ByteLength(content) > MAX_FILE_BYTES) {
        return `Error: Content is too large to write (limit ${MAX_FILE_BYTES} bytes).`;
      }

      const alreadyExists = await fileExists(filePath);

      if (alreadyExists && !overwrite) {
        return [
          `Error: File already exists: ${filePath}`,
          "Read it with read_file and edit it with edit_file, or pass overwrite=true to replace it entirely.",
        ].join("\n");
      }

      await writeText(filePath, content);

      throwIfAborted(signal);

      const lines = splitLines(content);
      const preview = formatNumberedLines(
        lines.slice(0, 20),
        1,
      );

      return [
        `${alreadyExists ? "Overwrote" : "Created"} file: ${filePath}`,
        `Lines: ${lines.length}`,
        "",
        preview,
        lines.length > 20 ? `\n[... ${lines.length - 20} more lines]` : "",
      ].join("\n");
    } catch (error) {
      // A cancelled run must surface as an abort, not as a tool error.
      if (isAbortError(error) || signal?.aborted) {
        throw error;
      }

      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "write_file",
    description:
      "Creates a new text file with the given content, creating parent folders as needed. " +
      "Existing files are never overwritten unless overwrite=true is passed. " +
      "To change part of an existing file, use edit_file instead.",
    schema: writeFileInputSchema,
  },
);

export default writeFileTool;
