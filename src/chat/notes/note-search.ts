import { Bm25Index } from "../docs/bm25";
import { listNotes } from "./note-storage";
import type { StoredNote } from "./note-storage";

export type NoteSearchResult = {
  note: StoredNote;
  /** BM25 score (higher = more relevant). */
  score: number;
};

/**
 * BM25-searches the saved notes. The title is repeated so title hits
 * outrank plain body mentions.
 */
export async function searchNotes(
  query: string,
  limit = 5,
): Promise<NoteSearchResult[]> {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const notes = await listNotes();

  if (notes.length === 0) {
    return [];
  }

  const index = new Bm25Index();

  for (const note of notes) {
    index.addDocument(
      note.file,
      [note.title, note.title, note.body].join("\n"),
    );
  }

  return index
    .search(trimmedQuery, limit)
    .map(({ id, score }) => ({
      note: notes.find((candidate) => candidate.file === id)!,
      score,
    }));
}
