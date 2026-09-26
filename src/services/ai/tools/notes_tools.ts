import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  saveNote,
  readNote,
  updateNote,
  deleteNote,
  listNotes,
} from "../../../chat/notes";

/**
 * Knowledge note tools.
 *
 * Lets the agents save what the user says into plain notes (the global
 * notes folder: BaseDirectory.AppData/notes). Notes are saved AS-IS — no
 * LLM rewriting. Before every answer the saved notes are BM25-searched and
 * only a one-line hint is injected into the prompt; the agent calls
 * read_note when it needs the actual content.
 */

const NOTE_TOOL_RESULT_LIMIT = 2_000;
const NOTE_READ_RESULT_LIMIT = 20_000;

function truncateResult(
  text: string,
  limit = NOTE_TOOL_RESULT_LIMIT,
): string {
  return text.length > limit
    ? `${text.slice(0, limit).trimEnd()}…`
    : text;
}

export const saveNoteTool = tool(
  async ({ text, title }) => {
    console.log("[Notes Tool] Saving note.");

    try {
      const fileName = await saveNote(text, title);

      return `Note saved as "${fileName}".`;
    } catch (error) {
      console.error("[Notes Tool] Failed to save note:", error);

      return `Error: The note could not be saved. Details: ${error}`;
    }
  },
  {
    name: "save_note",
    description:
      "Saves the given text as a note in the user's notes list, exactly as given — no rewriting, no summarizing. " +
      "Use when the user asks to save, remember or note something down.",
    schema: z.object({
      text: z
        .string()
        .describe("The exact text of the note, exactly as the user wants it saved"),
      title: z
        .string()
        .optional()
        .describe("Optional short title; the first line of the text is used when omitted"),
    }),
  },
);

export const readNoteTool = tool(
  async ({ fileName }) => {
    console.log(`[Notes Tool] Reading note: "${fileName}".`);

    try {
      const note = await readNote(fileName);

      if (!note) {
        return `Error: No note named "${fileName}" exists. Call list_notes to see the saved notes.`;
      }

      return truncateResult(
        [
          `Note "${note.file}":`,
          `Title: ${note.title}`,
          "",
          note.body,
        ].join("\n"),
        NOTE_READ_RESULT_LIMIT,
      );
    } catch (error) {
      console.error("[Notes Tool] Failed to read note:", error);

      return `Error: The note could not be read. Details: ${error}`;
    }
  },
  {
    name: "read_note",
    description:
      "Reads a saved note completely (full content) by its file name. " +
      "Use when a note hint appears in the prompt and you need to know what the note says before answering.",
    schema: z.object({
      fileName: z
        .string()
        .describe("Exact file name of the note, e.g. 'my-idea.md' (from the note hint or list_notes)"),
    }),
  },
);

export const updateNoteTool = tool(
  async ({ fileName, title, text }) => {
    console.log(`[Notes Tool] Updating note: "${fileName}".`);

    try {
      if (!title?.trim() && !text?.trim()) {
        return "Error: Provide a new title and/or new text to update.";
      }

      const note = await updateNote(fileName, { title, body: text });

      return `Note "${note.file}" updated.`;
    } catch (error) {
      console.error("[Notes Tool] Failed to update note:", error);

      return `Error: The note could not be updated. Details: ${error}`;
    }
  },
  {
    name: "update_note",
    description:
      "Updates an existing note's title and/or text by file name. The text is saved exactly as given.",
    schema: z.object({
      fileName: z
        .string()
        .describe("Exact file name of the note, e.g. 'my-idea.md' (from list_notes)"),
      title: z
        .string()
        .optional()
        .describe("New title; omit to keep the current one"),
      text: z
        .string()
        .optional()
        .describe("New full text of the note; omit to keep the current one"),
    }),
  },
);

export const deleteNoteTool = tool(
  async ({ fileName }) => {
    console.log(`[Notes Tool] Deleting note: "${fileName}".`);

    try {
      await deleteNote(fileName);

      return `Note "${fileName}" deleted.`;
    } catch (error) {
      console.error("[Notes Tool] Failed to delete note:", error);

      return `Error: The note could not be deleted. Details: ${error}`;
    }
  },
  {
    name: "delete_note",
    description:
      "Deletes a saved note by its exact file name. Only delete when the user clearly asks to remove it.",
    schema: z.object({
      fileName: z
        .string()
        .describe("Exact file name of the note, e.g. 'my-idea.md'"),
    }),
  },
);

export const listNotesTool = tool(
  async () => {
    console.log("[Notes Tool] Listing notes.");

    try {
      const notes = await listNotes();

      if (notes.length === 0) {
        return "No notes are saved yet.";
      }

      return truncateResult(
        notes
          .map(
            (note) =>
              `- ${note.file} | ${note.title}`,
          )
          .join("\n"),
      );
    } catch (error) {
      console.error("[Notes Tool] Failed to list notes:", error);

      return `Error: The notes could not be listed. Details: ${error}`;
    }
  },
  {
    name: "list_notes",
    description:
      "Lists all saved notes with their file names and titles. Call this first before reading, updating or deleting a note when you do not know the exact file name.",
    schema: z.object({}),
  },
);

export const notesTools = [
  saveNoteTool,
  readNoteTool,
  updateNoteTool,
  deleteNoteTool,
  listNotesTool,
] as const;
