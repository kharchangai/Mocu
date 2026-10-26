# PDF Reader

A polished, local PDF reader app for Mocu. It displays the **actual PDF pages** using the bundled Mozilla PDF.js renderer, preserving original text, typography, page layout, images, diagrams, tables, and equations instead of attempting to convert them into Markdown.

## Use in Mocu

Install this folder from **Extensions → Install from Folder**, then open **App → PDF Reader**. Choose a PDF or drag and drop it into the app. The document is read locally in the app, one original page at a time.

Reader controls and file information fade after three minutes so the page is unobstructed; move the pointer or focus the reader to reveal them again. Select text in a text-based PDF and choose **Translate** to invoke the saved **Text Translation Agent**. Set and save the target language from **Settings**; this preference is stored in this browser on this device. Translation requires the saved agent in Mocu.

Use **Previous / Next**, enter a page number, or use the left/right arrow keys to move through the document. **Fit width**, **Fit page**, and the zoom buttons adapt the page to the available space. Text-based PDFs support text selection and copying from the page; scanned image-only PDFs still need OCR for text recognition. `Home` and `End` move to the first and last page. Use **Open PDF** to switch documents. PDF processing does not upload documents or depend on internet access.

## PDF Markdown cache and explanations

When opened in Mocu, the reader extracts selectable text locally with its bundled PDF.js parser and stores one Markdown file per page in `<installed-extension-folder>/markdown-cache/<pdf-id>/1.md`, `2.md`, and so on (page numbering starts at 1). The PDF ID is derived from the normalized document title and extracted text. Existing usable page files are reused; missing, empty, invalid-UTF-8, or unreadable pages are regenerated. The original PDF remains the displayed document.

The `explain` action passes the selected text, PDF ID, page count, and absolute cache folder to the saved **PDF Markdown Simplification Agent**, which searches the cached pages and reads relevant context. Create that agent in Mocu's Agents page if it is not already present. MarkItDown itself is a Python library/CLI; this Node extension instead turns PDF.js's locally extracted text into Markdown, without converting visual layout, images, or scanned-page OCR. The cache is local to this extension installation and is removed if the extension installation is removed.

## Requirements and limits

The interface uses the bundled Mozilla PDF.js 6.4.299 module, worker, CMaps, and standard fonts under `ui/vendor/pdfjs/`. Each original PDF page is drawn at its native scale and overlaid with PDF.js's selectable text layer, so text can be selected and copied while images, diagrams, tables, and equations remain in their original positions. It does not need Python packages, a runtime command, network-loaded libraries, or OCR software. PDFs are limited to 100 MB. Password-protected PDFs must be unlocked before opening; scanned image-only PDFs display as original pages but require OCR for selectable text.

## Tests

With Node.js available, run:

```powershell
node tests/ui-smoke.mjs
node tests/pdfjs-smoke.mjs
```

The UI test checks the app script's JavaScript syntax, required interface and controls, selector references, bundled PDF.js resources, the native PDF file picker, and selectable text-layer hooks. The PDF.js test loads the bundled parser and worker against the included fixture PDF.

## Bundled dependency

The Mozilla PDF.js 6.4.299 distribution is provided under Apache License 2.0. Its CMaps and standard-font assets are bundled alongside the local worker.
