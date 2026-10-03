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
import {
  describeDocReferenceRejection,
  resolveDocReference,
} from "./doc-link-resolver";
import { removeDocFromIndex, syncDocIndexAfterWrite } from "./doc-index";

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

export type StoredDocWithRaw = StoredDoc & {
  /** Raw file content (feeds the index's SHA-256 content hash). */
  raw: string;
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

/**
 * Saves a doc to the global docs folder and returns its file name.
 * The SQLite index row is synchronized right after the file write; index
 * failures never fail the save (the markdown file is canonical and a later
 * reconcile rebuilds the row).
 */
export async function saveDoc(
  meta: DocFrontmatter,
  body: string,
): Promise<string> {
  await ensureDocsDirectory();

  const baseName = `${docNameToSlug(meta.title)}.md`;
  let fileName = baseName;

  // Avoid silently overwriting an existing doc with a different content.
  if (await fileExists(fileName)) {
    fileName = `${docNameToSlug(meta.title)}-${Date.now()}.md`;
  }

  // Never save a doc whose id duplicates a DIFFERENT existing doc:
  // deterministically suffix the id until it is unique.
  const metaToSave: DocFrontmatter = {
    ...meta,
    id: await ensureUniqueId(meta.id),
  };

  const raw = serializeDoc(metaToSave, body);
  await writeTextFile(`${DOCS_DIRECTORY}/${fileName}`, raw, {
    baseDir: BaseDirectory.AppData,
  });

  await syncDocIndexAfterWrite(fileName, metaToSave, body, raw);

  return fileName;
}

/**
 * Returns `id` when no other doc file already uses it, otherwise the
 * deterministic suffixes "-2", "-3", ... until a free id is found.
 */
async function ensureUniqueId(id: string): Promise<string> {
  const existing = await readAllDocs();
  const usedIds = new Set(existing.map((doc) => doc.id));

  const base = id || "doc";
  if (!usedIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

async function fileExists(fileName: string): Promise<boolean> {
  return exists(`${DOCS_DIRECTORY}/${fileName}`, {
    baseDir: BaseDirectory.AppData,
  });
}

/**
 * Overwrites an existing doc file (same file name) with new metadata/body
 * and refreshes its index row (content hash / embedding reuse included).
 */
export async function writeDocFile(
  fileName: string,
  meta: DocFrontmatter,
  body: string,
): Promise<void> {
  await ensureDocsDirectory();

  const raw = serializeDoc(meta, body);
  await writeTextFile(`${DOCS_DIRECTORY}/${fileName}`, raw, {
    baseDir: BaseDirectory.AppData,
  });

  await syncDocIndexAfterWrite(fileName, meta, body, raw);
}

/**
 * Loads a single doc by file name / docs-relative path.
 *
 * The reference is resolved by `resolveDocReference`, which canonicalizes
 * it against the global docs root (BaseDirectory.AppData/docs), strips
 * anchors, accepts root-relative references emitted in the prompt, and
 * rejects traversal, absolute paths, URLs and anything that would leave
 * the docs root. Returns null when missing, unsafe or invalid.
 */
export async function readDoc(fileName: string): Promise<StoredDoc | null> {
  const resolved = resolveDocReference(fileName);
  if (!resolved.ok) {
    console.warn(
      `[Docs] Rejected unsafe document reference "${fileName}" (${resolved.reason}).`,
    );
    return null;
  }

  const cleanName = resolved.path;

  try {
    const raw = await readTextFile(`${DOCS_DIRECTORY}/${cleanName}`, {
      baseDir: BaseDirectory.AppData,
    });

    const parsed = parseDoc(raw, { fileName: cleanName });

    return parsed ? { ...parsed, file: cleanName } : null;
  } catch {
    return null;
  }
}

/**
 * Same as `readDoc`, but rejects with an explicit, user-facing message
 * instead of returning null (used by the read tool so the agent learns
 * WHY a reference was refused).
 *
 * `currentDocPath` is the docs-relative path of the document that contains
 * the link being followed; relative link targets are resolved against its
 * folder. Omit it for plain file names / root-relative references.
 */
export async function readDocOrReject(
  reference: string,
  currentDocPath?: string,
): Promise<StoredDoc> {
  const resolved = resolveDocReference(reference, currentDocPath);
  if (!resolved.ok) {
    throw new Error(describeDocReferenceRejection(resolved.reason, reference));
  }

  const doc = await readDoc(resolved.path);
  if (!doc) {
    throw new Error(
      `No knowledge document at "${resolved.path}" inside the global docs folder. Call list_knowledge_docs to see the available documents.`,
    );
  }
  return doc;
}

/** Deletes a doc file from the global docs folder and its index row. */
export async function deleteDoc(fileName: string): Promise<void> {
  const resolved = resolveDocReference(fileName);
  if (!resolved.ok) {
    throw new Error(describeDocReferenceRejection(resolved.reason, fileName));
  }

  const cleanName = resolved.path;

  await remove(`${DOCS_DIRECTORY}/${cleanName}`, {
    baseDir: BaseDirectory.AppData,
  });

  await removeDocFromIndex(cleanName);
}

/**
 * Recursively enumerates Markdown files under the canonical global docs root.
 * Tauri's readDir returns only immediate children, so nested folders must be
 * traversed explicitly; relative paths stay docs-root-relative for indexing
 * and link resolution.
 */
async function listMarkdownFiles(
  relativeDirectory: string,
): Promise<string[]> {
  const directoryPath = relativeDirectory
    ? `${DOCS_DIRECTORY}/${relativeDirectory}`
    : DOCS_DIRECTORY;
  const entries = await readDir(directoryPath, {
    baseDir: BaseDirectory.AppData,
  });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    if (entry.isDirectory) {
      files.push(...(await listMarkdownFiles(relativePath)));
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      files.push(relativePath);
    }
  }

  return files;
}

/**
 * Loads every valid doc under the global docs folder together with raw content
 * (used for its SHA-256 index hash). Includes nested directories.
 */
export async function readAllDocsWithRaw(): Promise<StoredDocWithRaw[]> {
  if (!(await exists(DOCS_DIRECTORY, { baseDir: BaseDirectory.AppData }))) {
    return [];
  }

  const files = await listMarkdownFiles("");
  const docs: StoredDocWithRaw[] = [];
  const usedIds = new Set<string>();

  for (const file of files) {
    try {
      const raw = await readTextFile(`${DOCS_DIRECTORY}/${file}`, {
        baseDir: BaseDirectory.AppData,
      });

      const parsed = parseDoc(raw, { fileName: file });
      if (parsed) {
        // Collision safety: if two files claim the same id (hand-edited
        // frontmatter), the duplicate falls back to its file-name id,
        // which is unique because paths are unique within the docs folder.
        const id = usedIds.has(parsed.id)
          ? uniqueFileId(file, usedIds)
          : parsed.id;
        usedIds.add(id);
        docs.push({ ...parsed, id, file, raw });
      }
    } catch {
      // Skip unreadable/corrupt docs instead of failing the whole listing.
    }
  }

  return docs;
}

/** Loads every valid doc from the global docs folder. */
export async function readAllDocs(): Promise<StoredDoc[]> {
  const docs = await readAllDocsWithRaw();
  return docs.map(({ raw: _raw, ...doc }) => doc);
}

function uniqueFileId(fileName: string, usedIds: Set<string>): string {
  const base = docNameToSlug(fileName.replace(/\.md$/i, ""));

  if (!usedIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (usedIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}
