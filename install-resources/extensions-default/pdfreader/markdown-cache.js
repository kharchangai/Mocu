import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const PDF_ID_PATTERN = /^(?:sha256-[a-f0-9]{64}|fallback-[a-f0-9]+-[a-f0-9]+)$/u;

export function validatePdfId(pdfId) {
  if (typeof pdfId !== "string" || !PDF_ID_PATTERN.test(pdfId)) {
    throw new Error("Invalid PDF ID for the Markdown cache.");
  }
  return pdfId;
}

function validatePageCount(pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100_000) {
    throw new Error("Invalid PDF page count for the Markdown cache.");
  }
  return pageCount;
}

export function getCacheFolder(extensionRoot, pdfId) {
  if (typeof extensionRoot !== "string" || !extensionRoot.trim()) {
    throw new Error("Mocu did not provide the PDF Reader extension folder; Markdown cannot be saved.");
  }
  return path.resolve(extensionRoot, "markdown-cache", validatePdfId(pdfId));
}

async function isUsableMarkdown(filePath) {
  try {
    const details = await lstat(filePath);
    if (!details.isFile() || details.isSymbolicLink() || details.size === 0) return false;
    new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filePath));
    return true;
  } catch (_) {
    return false;
  }
}

/** Check every one-based page file; missing or invalid UTF-8 files are regenerated. */
export async function getMarkdownCacheStatus(extensionRoot, pdfId, pageCount) {
  const count = validatePageCount(pageCount);
  const folderPath = getCacheFolder(extensionRoot, pdfId);
  await mkdir(folderPath, { recursive: true });

  const missingPages = [];
  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    if (!(await isUsableMarkdown(path.join(folderPath, `${pageNumber}.md`)))) missingPages.push(pageNumber);
  }

  return { folderPath, complete: missingPages.length === 0, missingPages };
}

/** Save only missing/unusable one-based pages, leaving valid cached pages untouched. */
export async function saveMarkdownPages(extensionRoot, { pdfId, pageCount, pages }) {
  const count = validatePageCount(pageCount);
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 100) {
    throw new Error("Markdown cache batches must contain between 1 and 100 pages.");
  }

  const folderPath = getCacheFolder(extensionRoot, pdfId);
  await mkdir(folderPath, { recursive: true });
  const savedPages = [];
  const seen = new Set();

  for (const page of pages) {
    const pageNumber = page?.pageNumber;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > count || seen.has(pageNumber)) {
      throw new Error("Invalid or duplicate page number in the Markdown cache batch.");
    }
    if (typeof page.markdown !== "string") throw new Error("Markdown page content must be text.");
    seen.add(pageNumber);

    const destination = path.join(folderPath, `${pageNumber}.md`);
    if (await isUsableMarkdown(destination)) continue;

    const temporary = path.join(folderPath, `.${pageNumber}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, page.markdown, { encoding: "utf8", flag: "wx" });
      await rm(destination, { force: true });
      await rename(temporary, destination);
      savedPages.push(pageNumber);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  const status = await getMarkdownCacheStatus(extensionRoot, pdfId, count);
  return { ...status, savedPages };
}
