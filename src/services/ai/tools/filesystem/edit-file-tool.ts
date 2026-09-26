/*
 * edit_file tool — pi-style line editing.
 *
 * The agent reads a file with read_file (which returns line numbers),
 * then targets exact line ranges here. Each edit replaces the inclusive
 * line range [startLine, endLine] with the given text:
 *
 *   - replace line 7:          { startLine: 7,  endLine: 7,  text: "new text" }
 *   - replace lines 10-14:     { startLine: 10, endLine: 14, text: "..." }
 *   - delete lines 3-5:        { startLine: 3,  endLine: 5,  text: "" }
 *   - insert before line 20:   { startLine: 20, endLine: 19, text: "..." }
 *
 * All line numbers refer to the file as returned by read_file (1-based,
 * LF-normalized). Multiple edits in one call must not overlap and are
 * applied in a single pass, so the numbers stay valid.
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  applyLineEdits,
  formatNumberedLines,
  joinLines,
  splitLines,
  type LineEdit,
} from "./line-utils";
import {
  fileExists,
  readText,
  resolveAbsolutePath,
  writeText,
} from "./fs-adapter";

/**
 * How many context lines to show around each change in the result.
 */
const CONTEXT_LINES = 3;

export const lineEditInputSchema = z.object({
  startLine: z
    .number()
    .int()
    .min(1)
    .describe(
      "1-based number of the first line to replace (as shown by read_file). " +
        "For a pure insertion, the line the new text is inserted before.",
    ),

  endLine: z
    .number()
    .int()
    .min(0)
    .describe(
      "1-based number of the last line to replace (inclusive). " +
        "Use endLine = startLine - 1 to insert without removing any line.",
    ),

  text: z
    .string()
    .describe(
      "Replacement text for the range. Use '' to delete the lines. " +
        "Use '\\n' for new lines.",
    ),
});

export const editFileInputSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .describe(
      "Absolute path of the file to edit, e.g. 'E:\\\\project\\\\src\\\\index.ts'.",
    ),

  edits: z
    .array(lineEditInputSchema)
    .min(1)
    .describe(
      "One or more non-overlapping line edits. All line numbers refer to the file as returned by read_file.",
    ),
});

export type EditFileInput = z.infer<typeof editFileInputSchema>;
export type LineEditInput = z.infer<typeof lineEditInputSchema>;

/**
 * Builds the before/after context preview for one applied edit.
 */
function formatEditPreview(
  before: string[],
  after: string[],
  edit: LineEdit,
): string {
  const wasInsertion = edit.endLine < edit.startLine;
  const removedCount = wasInsertion ? 0 : edit.endLine - edit.startLine + 1;
  const insertedCount =
    edit.text === "" ? 0 : splitLines(edit.text).length;

  const beforeStart = Math.max(0, edit.startLine - 1 - CONTEXT_LINES);
  const beforeEnd = Math.min(
    before.length,
    (wasInsertion ? edit.startLine - 1 : edit.endLine) + CONTEXT_LINES,
  );

  const afterStart = beforeStart;
  const afterEnd = Math.min(after.length, afterStart + (beforeEnd - beforeStart) + (insertedCount - removedCount));

  return [
    `--- ${removedCount === 0 ? "inserted before" : "replaced"} line ${edit.startLine}` +
      (removedCount > 1 ? `-${edit.endLine}` : "") +
      ` (${removedCount} line(s) removed, ${insertedCount} inserted)`,
    formatNumberedLines(before.slice(beforeStart, beforeEnd), beforeStart + 1),
    "+++ after",
    formatNumberedLines(after.slice(afterStart, afterEnd), afterStart + 1),
  ].join("\n");
}

export const editFileTool = tool(
  async ({ path, edits }) => {
    try {
      const filePath = await resolveAbsolutePath(path);

      if (!(await fileExists(filePath))) {
        return `Error: File not found: ${filePath}`;
      }

      const content = await readText(filePath);
      const before = splitLines(content);

      const parsed: LineEdit[] = edits.map((edit) => ({
        startLine: edit.startLine,
        endLine: edit.endLine,
        text: edit.text,
      }));

      const after = applyLineEdits(before, parsed);

      await writeText(filePath, joinLines(after));

      const previews = parsed.map((edit) =>
        formatEditPreview(before, after, edit),
      );

      return [
        `Edited file: ${filePath}`,
        `Applied ${parsed.length} edit(s): ${before.length} -> ${after.length} lines.`,
        "",
        previews.join("\n\n"),
      ].join("\n");
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "edit_file",
    description:
      "Edits specific lines of an existing text file by line number. " +
      "Each edit replaces the inclusive line range [startLine, endLine] with text (use '' to delete lines, " +
      "or endLine = startLine - 1 to insert before startLine without removing anything). " +
      "Line numbers are the numbers shown by read_file. " +
      "All edits in one call are applied in a single pass and must not overlap. " +
      "Returns before/after context around every change.",
    schema: editFileInputSchema,
  },
);

export default editFileTool;
