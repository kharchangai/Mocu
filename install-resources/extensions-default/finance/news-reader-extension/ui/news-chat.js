(() => {
  "use strict";

  const button = document.getElementById("news-chat-toggle");
  const panel = document.getElementById("news-chat-panel");
  const closeButton = document.getElementById("news-chat-close");
  const form = document.getElementById("news-chat-form");
  const input = document.getElementById("news-chat-input");
  const messages = document.getElementById("news-chat-messages");
  let pending = false;
  let nextRequestId = 0;

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function inlineMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return html;
  }

  function tableCells(line) {
    let source = line.trim();
    if (source.startsWith("|")) source = source.slice(1);
    if (source.endsWith("|")) source = source.slice(0, -1);
    const cells = [];
    let cell = "";
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "\\" && source[index + 1] === "|") {
        cell += "|";
        index += 1;
      } else if (source[index] === "|") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += source[index];
      }
    }
    cells.push(cell.trim());
    return cells;
  }

  function renderMarkdown(markdown) {
    const output = [];
    let paragraph = [];
    let listType = "";
    let codeLines = null;
    const flushParagraph = () => {
      if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (listType) { output.push(`</${listType}>`); listType = ""; }
    };
    const sourceLines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const lines = [];
    let insideCodeBlock = false;
    for (const sourceLine of sourceLines) {
      if (/^\s*```/.test(sourceLine)) {
        insideCodeBlock = !insideCodeBlock;
        lines.push(sourceLine);
      } else if (!insideCodeBlock && /^\s*\|/.test(sourceLine)) {
        // Some model responses collapse an entire Markdown table onto one line.
        // Split only adjacent table rows ("| ... | | ... |"), not cell separators.
        lines.push(...sourceLine.replace(/\|[ \t]+\|/g, "|\n|").split("\n"));
      } else {
        lines.push(sourceLine);
      }
    }
    const tableDelimiter = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (/^\s*```/.test(line)) {
        flushParagraph(); closeList();
        if (codeLines) { output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`); codeLines = null; }
        else codeLines = [];
        continue;
      }
      if (codeLines) { codeLines.push(line); continue; }
      if (!line.trim()) { flushParagraph(); closeList(); continue; }

      if (/^\s*\|.*\|\s*$/.test(line) && tableDelimiter.test(lines[lineIndex + 1] || "")) {
        flushParagraph(); closeList();
        const headers = tableCells(line);
        const headerCount = headers.length;
        const rows = [];
        lineIndex += 2;
        while (lineIndex < lines.length && /^\s*\|.*\|\s*$/.test(lines[lineIndex])) {
          rows.push(tableCells(lines[lineIndex]));
          lineIndex += 1;
        }
        lineIndex -= 1;
        const headerHtml = headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
        const bodyHtml = rows.map((row) => `<tr>${Array.from({ length: headerCount }, (_, index) => `<td>${inlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`).join("");
        output.push(`<div class="news-chat-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
        continue;
      }

      const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
      if (heading) { flushParagraph(); closeList(); const level = heading[1].length; output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`); continue; }
      const item = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/);
      if (item) {
        flushParagraph();
        const wanted = /^\s*\d+[.)]/.test(line) ? "ol" : "ul";
        if (listType !== wanted) { closeList(); listType = wanted; output.push(`<${listType}>`); }
        output.push(`<li>${inlineMarkdown(item[1])}</li>`);
        continue;
      }
      closeList(); paragraph.push(line.trim());
    }
    flushParagraph(); closeList();
    if (codeLines) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    return output.join("\n");
  }

  function appendMessage(role, text, isError = false) {
    messages.querySelector(".news-chat-empty")?.remove();
    const message = document.createElement("div");
    message.className = `news-chat-message news-chat-message-${role}${isError ? " news-chat-message-error" : ""}`;
    if (role === "assistant" && !isError) message.innerHTML = renderMarkdown(text);
    else message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  }

  function articleForQuestion() {
    if (!window.newsReaderGetCurrentArticle) throw new Error("The news reader is not ready yet.");
    const article = window.newsReaderGetCurrentArticle();
    if (!article || !article.content) throw new Error("There is no open news story to ask about.");
    return article;
  }

  function setOpen(isOpen) {
    panel.classList.toggle("hidden", !isOpen);
    button.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) input.focus();
  }

  async function submitQuestion(event) {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || pending) return;

    let article;
    try { article = articleForQuestion(); }
    catch (error) { appendMessage("assistant", error instanceof Error ? error.message : String(error), true); setOpen(true); return; }

    const requestId = ++nextRequestId;
    pending = true;
    input.value = "";
    input.disabled = true;
    const send = form.querySelector("button[type=submit]");
    send.disabled = true;
    appendMessage("user", question);
    const loading = appendMessage("assistant", "Thinking…");
    try {
      const result = await window.mocu.extension.execute("ask-news-agent", {
        question,
        title: article.title,
        text: article.content,
      }, { timeoutMs: 180000 });
      const answer = typeof result === "string" ? result : result && typeof result.text === "string" ? result.text : "";
      if (!answer.trim()) throw new Error("The News Response Assistant returned no answer.");
      if (requestId === nextRequestId) {
        loading.innerHTML = renderMarkdown(answer.trim());
      }
    } catch (error) {
      if (requestId === nextRequestId) {
        loading.classList.add("news-chat-message-error");
        loading.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (requestId === nextRequestId) {
        pending = false;
        input.disabled = false;
        send.disabled = false;
        input.focus();
      }
    }
  }

  button.addEventListener("click", () => setOpen(panel.classList.contains("hidden")));
  closeButton.addEventListener("click", () => setOpen(false));
  form.addEventListener("submit", (event) => void submitQuestion(event));
  document.addEventListener("newsreader:article-opened", () => {
    nextRequestId += 1;
    pending = false;
    input.disabled = false;
    form.querySelector("button[type=submit]").disabled = false;
    messages.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "news-chat-empty";
    empty.textContent = "Ask a question about the story you are reading.";
    messages.append(empty);
  });
})();
