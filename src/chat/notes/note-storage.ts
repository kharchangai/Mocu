import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { parse, stringify } from "yaml";

/**
 * Notes live in the GLOBAL mocu folder (shared across projects):
 *
 *   BaseDirectory.AppData/notes/<slug>.md
 *
 * A note is a plain markdown file with a tiny YAML frontmatter
 * (title / createdAt / updatedAt). The body is saved EXACTLY as the user
 * said it — no LLM is involved, unlike the docs system.
 */
export const NOTES_DIRECTORY = "notes";

export type StoredNote = {
  /** File name inside the global notes folder, e.g. "my-idea.md". */
  file: string;
  title: string;
  body: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
};

type NoteFrontmatter = {
  title: string;
  createdAt: string;
  updatedAt: string;
};

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Serializes a note to markdown with YAML frontmatter. */
export function serializeNote(
  meta: NoteFrontmatter,
  body: string,
): string {
  const frontmatter = stringify({
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  });

  return `---\n${frontmatter}---\n${body.trim()}\n`;
}

/** Parses a note file. Returns null when the frontmatter is missing/invalid. */
export function parseNote(
  raw: string,
  fallbackFile: string,
): StoredNote | null {
  const trimmed = raw.trim();
  const match = trimmed.match(FRONTMATTER_REGEX);

  // Tolerate plain notes without frontmatter: everything is the body.
  if (!match) {
    if (!trimmed) {
      return null;
    }

    return {
      file: fallbackFile,
      title: titleFromBody(trimmed),
      body: trimmed,
      createdAt: "",
      updatedAt: "",
    };
  }

  let data: unknown;
  try {
    data = parse(match[1]);
  } catch {
    return null;
  }

  const record = (data ?? {}) as Record<string, unknown>;
  const body = match[2].trim();
  const title =
    typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : titleFromBody(body);

  return {
    file: fallbackFile,
    title,
    body,
    createdAt:
      typeof record.createdAt === "string" ? record.createdAt.trim() : "",
    updatedAt:
      typeof record.updatedAt === "string" ? record.updatedAt.trim() : "",
  };
}

/** Derives a short title from the first line of the note body. */
export function titleFromBody(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0].trim();

  return firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
}

/** Converts a note title into a safe file name, e.g. "My Note!" -> "my-note". */
export function noteTitleToSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-") // keep letters, digits and Persian/Arabic letters
    .replace(/^-+|-+$/g, "");

  return slug || "note";
}

export async function ensureNotesDirectory(): Promise<void> {
  const directoryExists = await exists(NOTES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  if (!directoryExists) {
    await mkdir(NOTES_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
  }
}

/**
 * Saves a new note containing the text AS-IS and returns its file name.
 * The title is optional: the first line of the text is used as fallback.
 */
export async function saveNote(
  body: string,
  title?: string,
): Promise<string> {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    throw new Error("Cannot save an empty note.");
  }

  await ensureNotesDirectory();

  const noteTitle = title?.trim() || titleFromBody(trimmedBody);
  const baseName = `${noteTitleToSlug(noteTitle)}.md`;
  let fileName = baseName;

  // Avoid silently overwriting an existing note.
  if (await noteFileExists(fileName)) {
    fileName = `${noteTitleToSlug(noteTitle)}-${Date.now()}.md`;
  }

  const now = new Date().toISOString();

  await writeTextFile(
    `${NOTES_DIRECTORY}/${fileName}`,
    serializeNote(
      { title: noteTitle, createdAt: now, updatedAt: now },
      trimmedBody,
    ),
    { baseDir: BaseDirectory.AppData },
  );

  return fileName;
}

/** Updates the title and/or body of an existing note (keeps createdAt). */
export async function updateNote(
  fileName: string,
  updates: { title?: string; body?: string },
): Promise<StoredNote> {
  const existing = await readNote(fileName);

  if (!existing) {
    throw new Error(`No note named "${fileName}" exists.`);
  }

  const title = updates.title?.trim() || existing.title;
  const body = updates.body?.trim() || existing.body;

  await writeTextFile(
    `${NOTES_DIRECTORY}/${existing.file}`,
    serializeNote(
      {
        title,
        createdAt: existing.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      body,
    ),
    { baseDir: BaseDirectory.AppData },
  );

  return {
    ...existing,
    title,
    body,
    updatedAt: new Date().toISOString(),
  };
}

/** Loads a single note by file name. Returns null when missing. */
export async function readNote(fileName: string): Promise<StoredNote | null> {
  const cleanName = sanitizeFileName(fileName);

  if (!cleanName) {
    return null;
  }

  try {
    const raw = await readTextFile(`${NOTES_DIRECTORY}/${cleanName}`, {
      baseDir: BaseDirectory.AppData,
    });

    return parseNote(raw, cleanName);
  } catch {
    return null;
  }
}

/** Deletes a note file from the global notes folder. */
export async function deleteNote(fileName: string): Promise<void> {
  const cleanName = sanitizeFileName(fileName);

  if (!cleanName) {
    throw new Error(`Invalid note file name: "${fileName}".`);
  }

  await remove(`${NOTES_DIRECTORY}/${cleanName}`, {
    baseDir: BaseDirectory.AppData,
  });
}

/** Loads every note, most recently updated first. */
export async function listNotes(): Promise<StoredNote[]> {
  if (!(await exists(NOTES_DIRECTORY, { baseDir: BaseDirectory.AppData }))) {
    return [];
  }

  const entries = await readDir(NOTES_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  const notes: StoredNote[] = [];

  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) {
      continue;
    }

    try {
      const raw = await readTextFile(`${NOTES_DIRECTORY}/${entry.name}`, {
        baseDir: BaseDirectory.AppData,
      });

      const parsed = parseNote(raw, entry.name);
      if (parsed) {
        notes.push(parsed);
      }
    } catch {
      // Skip unreadable/corrupt notes instead of failing the whole listing.
    }
  }

  return notes.sort((a, b) =>
    (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
  );
}

function sanitizeFileName(fileName: string): string {
  const cleanName = fileName.trim().replace(/^[/\\]+/, "");

  return cleanName.includes("..") ? "" : cleanName;
}

async function noteFileExists(fileName: string): Promise<boolean> {
  return exists(`${NOTES_DIRECTORY}/${fileName}`, {
    baseDir: BaseDirectory.AppData,
  });
}
