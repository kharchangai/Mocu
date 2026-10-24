(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const shell = $("#shell");
  const landing = $("#landing");
  const dropzone = $("#dropzone");
  const input = $("#file-input");
  const chooseButton = $("#choose-file");
  const status = $("#status");
  const progress = $("#progress");
  const progressFill = $("#progress > span");
  const reader = $("#reader");
  const readerBody = $("#reader-body");
  const readerStatus = $("#reader-status");
  const readerProgress = $("#reader-progress");
  const readerProgressFill = $("#reader-progress > span");
  const activeFileNameLabel = $("#page-label");
  const canvas = $("#pdf-canvas");
  const pageContainer = $("#pdf-page");
  const textLayerContainer = $("#text-layer");
  const pageInput = $("#page-number");
  const selectionAction = $("#selection-action");
  const translateSelectionButton = $("#translate-selection");
  const explainSelectionButton = $("#explain-selection");
  const translationPanel = $("#translation-panel");
  const translationTitle = $("#translation-title");
  const translationContent = $("#translation-content");
  const settingsDialog = $("#settings-dialog");
  const settingsForm = $("#settings-form");
  const targetLanguageInput = $("#target-language");
  const controlsHideDelayMs = 5 * 1000;
  const maxTranslationChars = 12000;
  const settingsStorageKey = "mocu.pdfreader.translationSettings.v1";
  const pageCount = $("#page-count");
  const previousButton = $("#previous");
  const nextButton = $("#next");
  const zoomOutButton = $("#zoom-out");
  const zoomInButton = $("#zoom-in");
  const fitPageButton = $("#fit-page");
  const maxFileBytes = 100 * 1024 * 1024;
  const maxCanvasPixels = 20_000_000;
  const maxDeviceScale = 2;
  const zoomSteps = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

  let pdfjsLib = null;
  let pdfDocument = null;
  let loadingTask = null;
  let activeFile = null;
  let currentPage = 1;
  let zoomFactor = 1;
  let fitWholePage = false;
  let renderTask = null;
  let textLayer = null;
  let renderSequence = 0;
  let loadSequence = 0;
  let isLoading = false;
  let resizeTimer = 0;
  let controlsHideTimer = 0;
  let controlsHidden = false;
  let selectedTextForTranslation = "";
  let selectedTextDirection = "ltr";
  let translationSequence = 0;
  let targetLanguage = "";
  function showStatus(message, isError = false, inReader = false) {
    const target = inReader ? readerStatus : status;
    target.textContent = message;
    target.classList.toggle("error", isError);
    target.hidden = false;
  }


  function showReaderStatus(message, isError = false) {
    showStatus(message, isError, true);
    window.clearTimeout(showReaderStatus.timer);
    if (!isError) showReaderStatus.timer = window.setTimeout(() => { readerStatus.hidden = true; }, 3600);
  }

  function scheduleControlsHide() {
    window.clearTimeout(controlsHideTimer);
    if (!pdfDocument || reader.hidden) return;
    controlsHideTimer = window.setTimeout(() => setControlsHidden(true), controlsHideDelayMs);
  }

  function setControlsHidden(hidden) {
    controlsHidden = hidden;
    shell.classList.toggle("controls-hidden", hidden);
  }

  function revealControls() {
    if (!pdfDocument || reader.hidden) return;
    if (controlsHidden) setControlsHidden(false);
    scheduleControlsHide();
  }

  function loadTargetLanguage() {
    try {
      const settings = JSON.parse(window.localStorage.getItem(settingsStorageKey) || "{}");
      targetLanguage = typeof settings.targetLanguage === "string" ? settings.targetLanguage.trim() : "";
    } catch (_) { targetLanguage = ""; }
    targetLanguageInput.value = targetLanguage;
  }
  loadTargetLanguage();

  function openSettings() {
    targetLanguageInput.value = targetLanguage;
    if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
    else settingsDialog.setAttribute("open", "");
    targetLanguageInput.focus();
    revealControls();
  }

  function closeSettings() {
    if (typeof settingsDialog.close === "function" && settingsDialog.open) settingsDialog.close();
    else settingsDialog.removeAttribute("open");
  }

  function getTextDirection(text) {
    for (const character of text) {
      if (!/\p{Letter}/u.test(character)) continue;
      return /\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Nko}|\p{Script=Adlam}/u.test(character) ? "rtl" : "ltr";
    }
    return "ltr";
  }

  function showTranslationMessage(message, isError = false) {
    translationContent.dir = selectedTextDirection;
    translationContent.replaceChildren();
    const node = document.createElement("p");
    node.className = "translation-message";
    node.textContent = message;
    if (isError) node.classList.add("error");
    translationContent.append(node);
    translationPanel.hidden = false;
  }

  function closeTranslation() {
    translationSequence += 1;
    translationPanel.hidden = true;
  }

  async function runSelectionCommand(commandId, title, button, progressMessage) {
    const text = selectedTextForTranslation;
    translationContent.dir = selectedTextDirection;
    if (!text) {
      selectionAction.hidden = true;
      showTranslationMessage("Select some text in the PDF first.", true);
      return;
    }
    if (!targetLanguage) {
      showTranslationMessage("Choose and save a target language in Settings before continuing.", true);
      openSettings();
      return;
    }
    if (text.length > maxTranslationChars) {
      showTranslationMessage("This selection is too long. Select up to 12,000 characters and try again.", true);
      return;
    }
    if (typeof window.mocu?.extension?.execute !== "function") {
      showTranslationMessage("This feature is only available inside the Mocu app.", true);
      return;
    }

    const sequence = ++translationSequence;
    button.disabled = true;
    translationTitle.textContent = `${title} · ${targetLanguage}`;
    showTranslationMessage(progressMessage);
    try {
      const result = await window.mocu.extension.execute(commandId, { text, targetLanguage });
      if (sequence !== translationSequence) return;
      const output = typeof result === "string" ? result.trim() : result && typeof result.text === "string" ? result.text.trim() : "";
      if (!output) throw new Error(`The ${title.toLowerCase()} agent returned an empty result.`);
      translationContent.dir = getTextDirection(output);
      translationContent.textContent = output;
      translationPanel.hidden = false;
    } catch (error) {
      if (sequence !== translationSequence) return;
      showTranslationMessage(error instanceof Error ? `${title} failed: ${error.message}` : `${title} failed. Please try again.`, true);
    } finally {
      button.disabled = false;
    }
  }

  function positionSelectionAction() {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.toString().trim() || !textLayerContainer.contains(selection.anchorNode) || !textLayerContainer.contains(selection.focusNode)) {
      selectionAction.hidden = true;
      selectedTextForTranslation = "";
      return;
    }
    selectedTextForTranslation = selection.toString().slice(0, maxTranslationChars + 1);
    selectedTextDirection = getTextDirection(selectedTextForTranslation);
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    selectionAction.hidden = false;
    const actionRect = selectionAction.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - actionRect.width - 8, rect.left + rect.width / 2 - actionRect.width / 2));
    const top = rect.top > 60 ? rect.top - actionRect.height - 8 : Math.min(window.innerHeight - actionRect.height - 8, rect.bottom + 8);
    selectionAction.style.left = `${left}px`;
    selectionAction.style.top = `${Math.max(8, top)}px`;
  }

  function setNavigationState() {
    const ready = Boolean(pdfDocument) && !isLoading;
    previousButton.disabled = !ready || currentPage <= 1;
    nextButton.disabled = !ready || currentPage >= (pdfDocument?.numPages ?? 0);
    pageInput.disabled = !ready;
    pageInput.max = String(pdfDocument?.numPages ?? 1);
    pageInput.value = String(currentPage);
    pageCount.textContent = String(pdfDocument?.numPages ?? 1);
  }
  function setLoading(value, message = "") {
    isLoading = value;
    chooseButton.disabled = value;
    $("#open-another").disabled = value;
    input.disabled = value;
    if (message) showStatus(message);
    progress.hidden = !value;
    progress.classList.toggle("indeterminate", value);
    if (!value) progressFill.style.width = "0%";
    setNavigationState();
  }

  function setZoomLabel() {
    const percentage = Math.round(zoomFactor * 100);
    $("#zoom-label").textContent = fitWholePage ? "Fit page" : `${percentage}%`;
    $("#zoom-short").textContent = fitWholePage ? "Fit page" : `${percentage}%`;
  }

  function setRenderProgress(visible) {
    readerProgress.hidden = !visible;
    readerProgress.classList.toggle("indeterminate", visible);
    if (!visible) readerProgressFill.style.width = "0%";
  }

  async function cancelCurrentRender() {
    const previous = renderTask;
    if (!previous) return;
    try { previous.cancel(); } catch (_) { /* The render may have already finished. */ }
    try { await previous.promise; } catch (_) { /* Cancellation releases the canvas. */ }
    if (renderTask === previous) renderTask = null;
  }

  async function disposeDocument() {
    renderSequence += 1;
    const oldTask = loadingTask;
    const oldDocument = pdfDocument;
    loadingTask = null;
    pdfDocument = null;
    activeFile = null;
    await cancelCurrentRender();
    try { textLayer?.cancel(); } catch (_) { /* Best-effort cleanup when replacing a text layer. */ }
    selectionAction.hidden = true;
    selectedTextForTranslation = "";
    translationSequence += 1;
    translationPanel.hidden = true;
    textLayer = null;
    textLayerContainer.replaceChildren();
    try {
      if (oldDocument) await oldDocument.destroy();
      else if (oldTask) await oldTask.destroy();
    } catch (_) { /* Best-effort cleanup when replacing a document. */ }
    canvas.width = 0;
    canvas.height = 0;
    pageContainer.style.width = "0px";
    pageContainer.style.height = "0px";
  }

  function pageScaleFor(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(120, readerBody.clientWidth - 4);
    const availableHeight = Math.max(180, readerBody.clientHeight - 4);
    const fitWidth = availableWidth / baseViewport.width;
    const scale = fitWholePage
      ? Math.min(fitWidth, availableHeight / baseViewport.height)
      : fitWidth * zoomFactor;
    return { baseViewport, scale: Math.max(0.05, scale) };
  }

  async function renderPage(pageNumber, { scrollTop = true } = {}) {
    const documentAtStart = pdfDocument;
    if (!documentAtStart || pageNumber < 1 || pageNumber > documentAtStart.numPages) return;
    const sequence = ++renderSequence;
    await cancelCurrentRender();
    if (sequence !== renderSequence || documentAtStart !== pdfDocument) return;

    currentPage = pageNumber;
    setNavigationState();
    setZoomLabel();
    activeFileNameLabel.textContent = activeFile?.name || "Original PDF";
    setRenderProgress(true);
    showReaderStatus(`Rendering page ${pageNumber} of ${documentAtStart.numPages}…`);
    if (scrollTop) readerBody.scrollTop = 0;

    try {
      const page = await documentAtStart.getPage(pageNumber);
      if (sequence !== renderSequence || documentAtStart !== pdfDocument) return;
      const { baseViewport, scale } = pageScaleFor(page);
      const viewport = page.getViewport({ scale });
      textLayer?.cancel();
      textLayer = null;
      textLayerContainer.replaceChildren();
      const requestedScale = Math.min(window.devicePixelRatio || 1, maxDeviceScale);
      const areaScale = Math.sqrt(maxCanvasPixels / Math.max(1, viewport.width * viewport.height));
      const outputScale = Math.min(requestedScale, areaScale);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This app could not create a canvas to display the PDF page.");

      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      pageContainer.style.width = `${Math.ceil(viewport.width)}px`;
      pageContainer.style.height = `${Math.ceil(viewport.height)}px`;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const task = page.render({
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        background: "#ffffff",
      });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if (error?.name === "RenderingCancelledException") return;
        throw error;
      } finally {
        if (renderTask === task) renderTask = null;
      }

      if (sequence !== renderSequence || documentAtStart !== pdfDocument) return;
      textLayerContainer.style.setProperty("--total-scale-factor", String(scale));
      const textContent = await page.getTextContent();
      if (sequence !== renderSequence || documentAtStart !== pdfDocument) return;
      textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerContainer,
        viewport,
      });
      await textLayer.render();
      if (sequence !== renderSequence || documentAtStart !== pdfDocument) return;
      page.cleanup();
      const viewScale = (readerBody.clientWidth - 4) / Math.max(1, baseViewport.width);
      const percent = Math.round((scale / viewScale) * 100);
      setNavigationState();
      showReaderStatus(`Original page ${pageNumber} of ${documentAtStart.numPages} · ${percent}% zoom · select or copy text directly from the page.`);
    } catch (error) {
      if (sequence !== renderSequence || documentAtStart !== pdfDocument) return;
      showReaderStatus(error instanceof Error ? `Could not render this PDF page: ${error.message}` : "Could not render this PDF page.", true);
    } finally {
      if (sequence === renderSequence) setRenderProgress(false);
    }
  }

  async function openFile(file) {
    if (isLoading || !file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf" && file.type !== "application/x-pdf") {
      showStatus("Please choose a PDF file.", true, Boolean(pdfDocument));
      return;
    }
    if (!file.size || file.size > maxFileBytes) {
      showStatus("PDF files must be larger than 0 bytes and no larger than 100 MB.", true, Boolean(pdfDocument));
      return;
    }
    if (!pdfjsLib) {
      showStatus("The PDF viewer could not load. Close and reopen the app, then try again.", true, Boolean(pdfDocument));
      return;
    }

    const sequence = ++loadSequence;
    setLoading(true, "Opening your PDF on this device…");
    try {
      await disposeDocument();
      if (sequence !== loadSequence) return;
      activeFile = file;
      const data = new Uint8Array(await file.arrayBuffer());
      if (sequence !== loadSequence) return;

      loadingTask = pdfjsLib.getDocument({
        data,
        cMapUrl: new URL("./vendor/pdfjs/cmaps/", document.baseURI).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("./vendor/pdfjs/standard_fonts/", document.baseURI).href,
        useWorkerFetch: false,
        isEvalSupported: false,
      });
      loadingTask.onProgress = ({ loaded, total }) => {
        if (sequence !== loadSequence || !total) return;
        const percent = Math.max(1, Math.min(100, Math.round(loaded * 100 / total)));
        progressFill.style.width = `${percent}%`;
        showStatus(`Reading PDF locally · ${percent}%`);
      };

      const loadedDocument = await loadingTask.promise;
      if (sequence !== loadSequence) {
        await loadedDocument.destroy();
        return;
      }
      if (!loadedDocument.numPages) throw new Error("This PDF does not contain any pages.");
      pdfDocument = loadedDocument;
      currentPage = 1;
      zoomFactor = 1;
      fitWholePage = true;
      $("#doc-name").textContent = file.name;
      $("#doc-meta").textContent = `${(file.size / (1024 * 1024)).toFixed(file.size < 1024 * 1024 ? 3 : 1)} MB · rendered from the original PDF`;
      reader.hidden = false;
      landing.hidden = true;
      shell.classList.add("reading");
      setControlsHidden(false);
      scheduleControlsHide();
      setLoading(false);
      await renderPage(1, { scrollTop: false });
    } catch (error) {
      if (sequence !== loadSequence) return;
      await disposeDocument();
      shell.classList.remove("reading");
      window.clearTimeout(controlsHideTimer);
      reader.hidden = true;
      landing.hidden = false;
      const message = error instanceof Error ? error.message : String(error);
      const userMessage = /password/i.test(message)
        ? "This PDF is password-protected. Unlock it and try again."
        : `Could not open this PDF: ${message}`;
      showStatus(userMessage, true);
    } finally {
      if (sequence === loadSequence) {
        setLoading(false);
        input.value = "";
      }
    }
  }

  function choosePdf() {
    if (!isLoading) input.click();
  }
  chooseButton.addEventListener("click", choosePdf);
  $("#open-another").addEventListener("click", choosePdf);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void openFile(file);
  });

  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choosePdf();
    }
  });

  for (const eventName of ["dragenter", "dragover"]) {
    shell.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (!isLoading) shell.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    shell.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName === "dragleave" && event.relatedTarget && shell.contains(event.relatedTarget)) return;
      shell.classList.remove("dragging");
    });
  }
  shell.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) void openFile(file);
  });

  previousButton.addEventListener("click", () => {
    if (!isLoading && currentPage > 1) void renderPage(currentPage - 1);
  });
  nextButton.addEventListener("click", () => {
    if (!isLoading && pdfDocument && currentPage < pdfDocument.numPages) void renderPage(currentPage + 1);
  });
  pageInput.addEventListener("change", () => {
    if (!pdfDocument) return;
    const requestedPage = Number.parseInt(pageInput.value, 10);
    if (!Number.isFinite(requestedPage)) {
      pageInput.value = String(currentPage);
      return;
    }
    void renderPage(Math.max(1, Math.min(pdfDocument.numPages, requestedPage)));
  });
  pageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      pageInput.blur();
    }
  });

  $("#open-settings").addEventListener("click", openSettings);
  $("#close-settings").addEventListener("click", closeSettings);
  $("#cancel-settings").addEventListener("click", closeSettings);
  settingsDialog.addEventListener("click", (event) => { if (event.target === settingsDialog) closeSettings(); });
  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = targetLanguageInput.value.trim();
    if (!value) { targetLanguageInput.focus(); return; }
    targetLanguage = value.slice(0, 80);
    try {
      window.localStorage.setItem(settingsStorageKey, JSON.stringify({ targetLanguage }));
      closeSettings();
      if (reader.hidden) showStatus(`Target language saved: ${targetLanguage}.`);
      else showReaderStatus(`Target language saved: ${targetLanguage}.`);
    } catch (_) {
      targetLanguage = "";
      showStatus("Could not save settings in this browser. Check its storage permissions.", true, !reader.hidden);
    }
  });
  $("#close-translation").addEventListener("click", closeTranslation);
  translateSelectionButton.addEventListener("click", () => void runSelectionCommand("translate", "Translation", translateSelectionButton, "Translating selected text…"));
  explainSelectionButton.addEventListener("click", () => void runSelectionCommand("explain", "Simple explanation", explainSelectionButton, "Explaining selected text…"));
  const refreshSelectionAction = () => window.requestAnimationFrame(positionSelectionAction);
  window.addEventListener("selectionchange", refreshSelectionAction);
  textLayerContainer.addEventListener("pointerup", refreshSelectionAction);
  textLayerContainer.addEventListener("mouseup", refreshSelectionAction);
  textLayerContainer.addEventListener("touchend", refreshSelectionAction, { passive: true });
  readerBody.addEventListener("scroll", () => { if (!selectionAction.hidden) positionSelectionAction(); }, { passive: true });
  window.addEventListener("resize", () => { if (!selectionAction.hidden) positionSelectionAction(); });
  for (const button of [translateSelectionButton, explainSelectionButton]) button.addEventListener("mousedown", (event) => event.preventDefault());
  shell.addEventListener("pointermove", revealControls, { passive: true });
  shell.addEventListener("pointerdown", revealControls, { passive: true });
  shell.addEventListener("focusin", revealControls);
  shell.addEventListener("keydown", revealControls);
  zoomOutButton.addEventListener("click", () => {
    if (!pdfDocument || isLoading) return;
    fitWholePage = false;
    const currentIndex = zoomSteps.findIndex((step) => step >= zoomFactor - 0.001);
    zoomFactor = zoomSteps[Math.max(0, (currentIndex < 0 ? zoomSteps.length - 1 : currentIndex) - 1)];
    setZoomLabel();
    void renderPage(currentPage, { scrollTop: false });
  });
  zoomInButton.addEventListener("click", () => {
    if (!pdfDocument || isLoading) return;
    fitWholePage = false;
    const currentIndex = zoomSteps.findIndex((step) => step > zoomFactor + 0.001);
    if (currentIndex >= 0) zoomFactor = zoomSteps[currentIndex];
    setZoomLabel();
    void renderPage(currentPage, { scrollTop: false });
  });
  fitPageButton.addEventListener("click", () => {
    if (!pdfDocument || isLoading) return;
    fitWholePage = false;
    zoomFactor = 1;
    setZoomLabel();
    void renderPage(currentPage, { scrollTop: false });
  });

  window.addEventListener("keydown", (event) => {
    if (!pdfDocument || isLoading || event.altKey || event.metaKey) return;
    if (event.ctrlKey && (event.key === "+" || event.key === "=" || event.key === "-")) {
      event.preventDefault();
      (event.key === "-" ? zoomOutButton : zoomInButton).click();
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      if (currentPage > 1) void renderPage(currentPage - 1);
    } else if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      if (currentPage < pdfDocument.numPages) void renderPage(currentPage + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      void renderPage(1);
    } else if (event.key === "End") {
      event.preventDefault();
      void renderPage(pdfDocument.numPages);
    }
  });

  window.addEventListener("resize", () => {
    if (!pdfDocument || reader.hidden) return;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void renderPage(currentPage, { scrollTop: false }), 180);
  });

  setNavigationState();
  import(new URL("./vendor/pdfjs/pdf.min.mjs", document.baseURI).href)
    .then((library) => {
      pdfjsLib = library;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.min.mjs", document.baseURI).href;
      showStatus("Your PDF stays on this device.");
    })
    .catch((error) => {
      showStatus(`Could not start the local PDF viewer: ${error instanceof Error ? error.message : String(error)}`, true);
    });
})();