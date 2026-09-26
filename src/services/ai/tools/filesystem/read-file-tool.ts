/*
 * read_file tool — pi-style file reading.
 *
 * Returns the file content with line numbers so the agent can reference
 * exact lines later in edit_file. Supports offset/limit for reading a
 * specific window of a large file.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  formatNumberedLines,
  splitLines,
} from "./line-utils";
import {
  fileExists,
  readText,
  resolveAbsolutePath,
  utf8ByteLength,
} from "./fs-adapter";

/**
 * Output limits, mirroring pi's read tool behaviour.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_LINES = 2_000;
const MAX_OUTPUT_CHARS = 50_000;

export const readFileInputSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Absolute path of the file to read, e.g. 'E:\\\\project\\\\src\\\\index.ts'.",
    ),

  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based line number to start reading from. Omit to start at line 1.",
    ),

  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_OUTPUT_LINES)
    .optional()
    .describe(
      `Maximum number of lines to return (max ${MAX_OUTPUT_LINES}). Omit to read up to the output limit.`,
    ),
});

export type ReadFileInput = z.infer<typeof readFileInputSchema>;

/**
 * Renders a line window of a file with line numbers.
 * Exported for tests.
 */
export function renderNumberedWindow(
  content: string,
  offset: number,
  limit: number,
): { text: string; totalLines: number; shownFrom: number; shownTo: number } {
  const lines = splitLines(content);
  const totalLines = lines.length;

  const start = Math.min(offset, totalLines + 1) - 1;
  const end = Math.min(start + limit, totalLines);
  const window = lines.slice(start, end);

  // Enforce the char budget without breaking the line window.
  let charBudget = MAX_OUTPUT_CHARS;
  const kept: string[] = [];

  for (const line of window) {
    charBudget -= line.length + 1;
    if (charBudget < 0) {
      break;
    }
    kept.push(line);
  }

  return {
    text: formatNumberedLines(kept, start + 1),
    totalLines,
    shownFrom: start + 1,
    shownTo: start + kept.length,
  };
}

export const readFileTool = tool(
  async ({ path, offset, limit }) => {
    try {
      const filePath = await resolveAbsolutePath(path);

      if (!(await fileExists(filePath))) {
        return `Error: File not found: ${filePath}`;
      }

      const content = await readText(filePath);

      if (utf8ByteLength(content) > MAX_FILE_BYTES) {
        return `Error: File is too large to read (limit ${MAX_FILE_BYTES} bytes): ${filePath}`;
      }

      const { text, totalLines, shownFrom, shownTo } = renderNumberedWindow(
        content,
        offset ?? 1,
        limit ?? MAX_OUTPUT_LINES,
      );

      const header = [
        `File: ${filePath}`,
        `Lines: ${totalLines} total, showing ${shownFrom}-${shownTo}`,
      ].join("\n");

      const footer =
        shownTo < totalLines
          ? `\n\n[Output truncated. Continue with offset=${shownTo + 1} to read more.]`
          : "";

      return `${header}\n\n${text}${footer}`;
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "read_file",
    description:
      "Reads a text file and returns its content with 1-based line numbers (format: '  12 | text'). " +
      "Use offset and limit to read a specific line window of a large file. " +
      "The returned line numbers are the numbers to pass to edit_file for changing those exact lines.",
    schema: readFileInputSchema,
  },
);

export default readFileTool;
