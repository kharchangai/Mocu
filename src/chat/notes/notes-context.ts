import { searchNotes } from "./note-search";

/** How many note hints are injected at most. */
const MAX_NOTES = 2;

/**
 * Builds a tiny system-prompt hint for a user message, or "" when no saved
 * note matches.
 *
 * The hint is ONE line: it only names the matching notes. No content. If
 * the agent cares, it calls the read_note tool.
 *
 * Never throws: callers can safely await this before building the prompt.
 */
export async function buildNotesContextPrompt(
  userText: string,
  options: {
    notesLimit?: number;
  } = {},
): Promise<string> {
  const trimmedInput = userText.trim();

  if (!trimmedInput) {
    return "";
  }

  let results: Awaited<ReturnType<typeof searchNotes>> = [];

  try {
    results = await searchNotes(trimmedInput, options.notesLimit ?? MAX_NOTES);
  } catch (error) {
    console.warn("[Notes Context] Note hint search failed:", error);
    return "";
  }

  if (results.length === 0) {
    return "";
  }

  return `SAVED NOTES: ${results
    .map((result) => `"${result.note.file}"`)
    .join(", ")} — may relate to the user's message. Call read_note if you need their content, otherwise ignore.`;
}
