import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getCacheFolder, getMarkdownCacheStatus, saveMarkdownPages, validatePdfId } from "../markdown-cache.js";

const root = await mkdtemp(path.join(os.tmpdir(), "mocu-pdf-markdown-"));
const pdfId = `sha256-${"a".repeat(64)}`;
const otherPdfId = `sha256-${"b".repeat(64)}`;
try {
  const folder = getCacheFolder(root, pdfId);
  assert.equal(folder, path.join(root, "markdown-cache", pdfId), "PDF ID chooses a stable, isolated cache folder");
  assert.throws(() => validatePdfId("..\\outside"), /Invalid PDF ID/, "untrusted path components cannot escape cache root");

  const initial = await getMarkdownCacheStatus(root, pdfId, 2);
  assert.equal(initial.complete, false);
  assert.deepEqual(initial.missingPages, [1, 2]);

  const firstSave = await saveMarkdownPages(root, {
    pdfId,
    pageCount: 2,
    pages: [
      { pageNumber: 1, markdown: "# Page 1\n\nAlpha passage.\n" },
      { pageNumber: 2, markdown: "# Page 2\n\nBeta passage.\n" },
    ],
  });
  assert.equal(firstSave.complete, true);
  assert.deepEqual(firstSave.savedPages, [1, 2]);
  assert.equal(await readFile(path.join(folder, "1.md"), "utf8"), "# Page 1\n\nAlpha passage.\n");
  assert.equal(await readFile(path.join(folder, "2.md"), "utf8"), "# Page 2\n\nBeta passage.\n");

  const reuse = await saveMarkdownPages(root, {
    pdfId,
    pageCount: 2,
    pages: [
      { pageNumber: 1, markdown: "overwritten text" },
      { pageNumber: 2, markdown: "overwritten text" },
    ],
  });
  assert.deepEqual(reuse.savedPages, [], "complete page cache is reused without overwriting");
  assert.equal(await readFile(path.join(folder, "1.md"), "utf8"), "# Page 1\n\nAlpha passage.\n");

  await rm(path.join(folder, "2.md"));
  const incomplete = await getMarkdownCacheStatus(root, pdfId, 2);
  assert.deepEqual(incomplete.missingPages, [2]);
  const recovered = await saveMarkdownPages(root, {
    pdfId,
    pageCount: 2,
    pages: [{ pageNumber: 2, markdown: "# Page 2\n\nRecovered.\n" }],
  });
  assert.equal(recovered.complete, true, "missing page is safely regenerated");

  const secondFolder = getCacheFolder(root, otherPdfId);
  await mkdir(secondFolder, { recursive: true });
  await writeFile(path.join(secondFolder, "1.md"), Buffer.from([0xff, 0xfe]));
  const unreadableCache = await getMarkdownCacheStatus(root, otherPdfId, 1);
  assert.deepEqual(unreadableCache.missingPages, [1], "invalid UTF-8 cache files are not treated as usable");
  const recoveredLink = await saveMarkdownPages(root, {
    pdfId: otherPdfId,
    pageCount: 1,
    pages: [{ pageNumber: 1, markdown: "# Page 1\n\nSafe replacement.\n" }],
  });
  assert.equal(recoveredLink.complete, true, "invalid cache entry is repaired");
  assert.equal(await readFile(path.join(secondFolder, "1.md"), "utf8"), "# Page 1\n\nSafe replacement.\n");

  console.log("PDF Markdown cache smoke test passed: per-PDF folders, page filenames, cache reuse, and incomplete/unreadable recovery.");
} finally {
  await rm(root, { recursive: true, force: true });
}
