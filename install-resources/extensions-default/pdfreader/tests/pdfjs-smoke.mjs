import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as pdfjsLib from "../ui/vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "../ui/vendor/pdfjs/pdf.worker.min.mjs",
  import.meta.url,
).href;

const bytes = new Uint8Array(
  await readFile(new URL("./fixtures/sample.pdf", import.meta.url)),
);
const loadingTask = pdfjsLib.getDocument({
  data: bytes,
  cMapUrl: new URL("../ui/vendor/pdfjs/cmaps/", import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL("../ui/vendor/pdfjs/standard_fonts/", import.meta.url).href,
  useWorkerFetch: false,
  isEvalSupported: false,
});

try {
  const pdf = await loadingTask.promise;
  assert.equal(pdf.numPages, 1, "sample contains one original PDF page");
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  assert.ok(viewport.width > 0 && viewport.height > 0, "page has renderable dimensions");
  const content = await page.getTextContent();
  const text = content.items.map((item) => item.str).join(" ");
  assert.match(text, /PDF\.js browser integration test/);
  assert.match(text, /E = mc squared/);
  console.log("PDF.js local-worker smoke test passed:", {
    pages: pdf.numPages,
    width: viewport.width,
    height: viewport.height,
    extractedTextLength: text.length,
  });
} finally {
  await loadingTask.destroy();
}
