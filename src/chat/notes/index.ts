/**
 * Mocu notes: plain saved notes, no LLM involved.
 *
 * Flow:
 *   1. `saveNote(text)` — saves EXACTLY what the user said as a note in the
 *      global notes folder (BaseDirectory.AppData/notes). The agent does
 *      this with the save_note tool when the user wants to save something.
 *   2. `searchNotes(query)` — BM25 search over the saved notes. Runs before
 *      every answer and only injects a ONE-LINE hint ("there is a note,
 *      call read_note if you need it") into the prompt.
 */
export {
  saveNote,
  updateNote,
  readNote,
  deleteNote,
  listNotes,
  parseNote,
  serializeNote,
  noteTitleToSlug,
  titleFromBody,
  NOTES_DIRECTORY,
} from "./note-storage";
export type { StoredNote } from "./note-storage";

export { searchNotes } from "./note-search";
export type { NoteSearchResult } from "./note-search";

export { buildNotesContextPrompt } from "./notes-context";
