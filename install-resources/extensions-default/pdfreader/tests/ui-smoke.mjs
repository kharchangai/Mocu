import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");
const scriptMatch = html.match(/<script\s+src="\.\/reader\.js"><\/script>/);
assert.ok(scriptMatch, "the app loads its self-hosted local reader script");
const script = await readFile(new URL("../ui/reader.js", import.meta.url), "utf8");
new vm.Script(script, { filename: "reader.js" });
assert.match(script, /^\s*loadTargetLanguage\(\);\s*$/m, "saved translation settings are loaded when the reader starts");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "HTML element IDs are unique");
const actualIds = new Set(ids);
for (const match of script.matchAll(/\$\("#([^"\s>]+)/g)) {
  assert.ok(actualIds.has(match[1]), `UI code selector #${match[1]} refers to an existing element`);
}
for (const id of [
  "pdf-canvas", "pdf-page", "text-layer", "highlight-layer", "highlight-selection", "selection-action", "page-number", "page-count", "previous", "next", "zoom-in",
  "zoom-out", "fit-page", "open-another",
]) {
  assert.ok(actualIds.has(id), `reader includes ${id}`);
}
assert.match(html, /type="file" accept="application\/pdf,\.pdf"/, "the app opens PDFs using its native file picker");
assert.match(script, /file\.arrayBuffer\(\)/, "PDF input is read as binary data locally");
assert.match(script, /pdf\.worker\.min\.mjs/, "the bundled PDF.js worker is configured");
assert.match(script, /new pdfjsLib\.TextLayer/, "PDF text is rendered in a selectable overlay over the page canvas");
assert.match(script, /page\.getTextContent\(\)/, "selectable text comes from the PDF page text content");
assert.match(script, /extractPdfPageText\(content\)/, "PDF.js extracted page text is converted into per-page Markdown content");
assert.match(script, /ensureMarkdownCache\(activePdfId, loadedDocument\.numPages/, "each opened PDF is cached by its stable ID");
assert.match(script, /pdfId: activePdfId, pageCount: pdfDocument\.numPages/, "the explain action identifies its PDF Markdown cache");
assert.match(html, /user-select:\s*text/, "text layer allows users to select and copy text");
assert.match(script, /cMapUrl/, "bundled PDF character maps are configured");
assert.match(html, /\.shell\.reading \.reader-body\s*\{[^}]*position:\s*absolute;\s*inset:\s*0;/, "the reader viewport expands to the full window after opening a PDF");
assert.match(html, /\.shell\.reading \.reader-actions\s*\{[^}]*pointer-events:\s*auto;/, "reader tools float above the page without reserving document space");
assert.match(html, /\.shell\.reading \.page-controls\s*\{[^}]*pointer-events:\s*auto;/, "page navigation controls float over the page");
assert.match(script, /shell\.classList\.add\("reading"\)/, "full-screen reading mode activates after a document opens");
assert.match(script, /fitWholePage = true;/, "new PDFs open initially fitted to the complete page");
const documentAssignment = script.indexOf("pdfDocument = loadedDocument;");
const documentIdentity = script.indexOf("const identity = await identifyPdf(loadedDocument, file, sequence);");
const firstResumeRender = script.indexOf("await renderPage(currentPage, { scrollTop: false });");
assert.ok(documentIdentity >= 0 && documentAssignment > documentIdentity && firstResumeRender > documentAssignment, "the reader identifies PDFs before restoring their saved page");
assert.match(script, /hashText\(textParts\.join\("\\n"\)\)/, "PDF text is hashed for document identity");
assert.match(script, /readingStoragePrefix/, "reading position and highlights use document-specific storage");
assert.match(script, /renderSavedHighlights\(pageNumber\)/, "saved highlights render on their original PDF page");
assert.match(script, /highlightSelectionButton\.addEventListener\("click", addSelectionHighlight\)/, "selected text can be toggled as a persistent highlight");
assert.match(html, /id="highlight-selection"[^>]*>\s*<svg/, "highlight action displays an icon instead of a text label");
assert.match(script, /documentState\.highlights\.findIndex\(/, "clicking the same selected text finds its existing highlight");
assert.match(script, /documentState\.highlights\.splice\(existingIndex, 1\)/, "clicking highlight again removes the existing highlight");
assert.match(script, /showReaderStatus\(existingIndex >= 0 \? "Highlight removed\." : "Highlight saved\."\)/, "the reader reports whether the highlight was saved or removed");

console.log("PDF Reader UI smoke test passed:", {
  uniqueElements: ids.length,
  selectorsChecked: [...script.matchAll(/\$\("#([^"\s>]+)/g)].length,
  bundledPdfJs: "6.4.299",
  moduleScript: "valid JavaScript",
});
