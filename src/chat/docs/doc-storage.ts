import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { docNameToSlug, parseDoc, serializeDoc } from "./doc-frontmatter";
import type { DocFrontmatter } from "./doc-frontmatter";
import type { ParsedDoc } from "./doc-frontmatter";

/**
 * Docs live in the GLOBAL mocu folder (shared across projects):
 *
 *   BaseDirectory.AppData/docs/<slug>.md
 *
 * On Windows this is %APPDATA%/com.mocu.app/docs.
 */
export const DOCS_DIRECTORY = "docs";

export type StoredDoc = ParsedDoc & {
  /** File name inside the global docs folder, e.g. "my-cool-doc.md". */
  file: string;
};

export async function ensureDocsDirectory(): Promise<void> {
  const directoryExists = await exists(DOCS_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  if (!directoryExists) {
    await mkdir(DOCS_DIRECTORY, {
      baseDir: BaseDirectory.AppData,
      recursive: true,
    });
  }
}

/** Saves a doc to the global docs folder and returns its file name. */
export async function saveDoc(
  meta: DocFrontmatter,
  body: string,
): Promise<string> {
  await ensureDocsDirectory();

  const baseName = `${docNameToSlug(meta.name)}.md`;
  let fileName = baseName;

  // Avoid silently overwriting an existing doc with a different content.
  if (await fileExists(fileName)) {
    fileName = `${docNameToSlug(meta.name)}-${Date.now()}.md`;
  }

  await writeTextFile(`${DOCS_DIRECTORY}/${fileName}`, serializeDoc(meta, body), {
    baseDir: BaseDirectory.AppData,
  });

  return fileName;
}

async function fileExists(fileName: string): Promise<boolean> {
  return exists(`${DOCS_DIRECTORY}/${fileName}`, {
    baseDir: BaseDirectory.AppData,
  });
}

/** Overwrites an existing doc file (same file name) with new metadata/body. */
export async function writeDocFile(
  fileName: string,
  meta: DocFrontmatter,
  body: string,
): Promise<void> {
  await ensureDocsDirectory();

  await writeTextFile(
    `${DOCS_DIRECTORY}/${fileName}`,
    serializeDoc(meta, body),
    { baseDir: BaseDirectory.AppData },
  );
}

/** Loads a single doc by file name. Returns null when missing/invalid. */
export async function readDoc(fileName: string): Promise<StoredDoc | null> {
  const cleanName = fileName.trim().replace(/^[/\\]+/, "");

  if (!cleanName || cleanName.includes("..")) {
    return null;
  }

  try {
    const raw = await readTextFile(`${DOCS_DIRECTORY}/${cleanName}`, {
      baseDir: BaseDirectory.AppData,
    });

    const parsed = parseDoc(raw);

    return parsed ? { ...parsed, file: cleanName } : null;
  } catch {
    return null;
  }
}

/** Deletes a doc file from the global docs folder. */
export async function deleteDoc(fileName: string): Promise<void> {
  const cleanName = fileName.trim().replace(/^[/\\]+/, "");

  if (!cleanName || cleanName.includes("..")) {
    throw new Error(`Invalid document file name: "${fileName}".`);
  }

  await remove(`${DOCS_DIRECTORY}/${cleanName}`, {
    baseDir: BaseDirectory.AppData,
  });
}

/** Loads every valid doc from the global docs folder. */
export async function readAllDocs(): Promise<StoredDoc[]> {
  if (!(await exists(DOCS_DIRECTORY, { baseDir: BaseDirectory.AppData }))) {
    return [];
  }

  const entries = await readDir(DOCS_DIRECTORY, {
    baseDir: BaseDirectory.AppData,
  });

  const docs: StoredDoc[] = [];

  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith(".md")) {
      continue;
    }

    try {
      const raw = await readTextFile(`${DOCS_DIRECTORY}/${entry.name}`, {
        baseDir: BaseDirectory.AppData,
      });

      const parsed = parseDoc(raw);
      if (parsed) {
        docs.push({ ...parsed, file: entry.name });
      }
    } catch {
      // Skip unreadable/corrupt docs instead of failing the whole listing.
    }
  }

  return docs;
}
