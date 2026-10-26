import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const backend = await readFile(new URL("../index.js", import.meta.url), "utf8");
const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../ui/reader.js", import.meta.url), "utf8");

assert.deepEqual(manifest.permissions, ["agents.invoke"]);
assert.ok(manifest.commands.some((command) => command.id === "translate"));
assert.ok(manifest.commands.some((command) => command.id === "cacheMarkdown"));
assert.equal(manifest.commands.find((command) => command.id === "explain")?.timeoutSeconds, 0);
assert.match(backend, /Text Translation Agent/);
assert.match(backend, /PDF Markdown Simplification Agent/);
assert.match(backend, /cache\.folderPath/);
assert.match(backend, /input\.pdfId/);
assert.match(backend, /extension\.agents\.list\(\)/);
assert.match(backend, /extension\.agents\.run\(/);
assert.match(backend, /targetLanguage/);
assert.match(html, /id="open-settings"/);
assert.match(html, /id="target-language"/);
assert.match(html, /id="selection-action"/);
const translateButton = html.match(/<button id="translate-selection"[\s\S]*?<\/button>/)?.[0] ?? "";
assert.match(translateButton, /<svg/, "selection action shows the Translate icon");
assert.match(translateButton, /aria-label="Translate selected text"/, "icon-only button remains accessible");
assert.doesNotMatch(translateButton, /<span>/, "selection action has no visible Translate label");
assert.match(ui, /controlsHideDelayMs = 5 \* 1000/);
assert.match(ui, /window\.localStorage\.setItem\(settingsStorageKey/);
assert.match(ui, /let commandInput = \{ text, targetLanguage \}/, "selected-text actions include the requested language");
assert.match(ui, /window\.mocu\.extension\.execute\(commandId, commandInput\)/, "selected-text actions invoke their extension command with the computed arguments");
assert.match(ui, /selectedTextForTranslation/);
assert.match(ui, /ensureMarkdownCache\(activePdfId, loadedDocument\.numPages/);
assert.match(ui, /pdfId: activePdfId, pageCount: pdfDocument\.numPages/);
assert.match(ui, /selectedTextDirection = getTextDirection\(selectedTextForTranslation\)/, "translation direction follows the selected text script");
assert.match(ui, /translationContent\.dir = selectedTextDirection/, "translation status follows the selected text direction");
assert.match(ui, /translationContent\.dir = getTextDirection\(output\)/, "completed translation direction follows the translated text script");
assert.match(ui, /Script=Arabic[\s\S]*?Script=Hebrew/, "direction detection handles right-to-left scripts");
assert.match(html, /\.translation-content\.markdown-content\s*\{[^}]*white-space:\s*normal;/, "explanation Markdown uses rendered block layout");
assert.match(ui, /function renderMarkdown\(markdown\)/, "simple explanation output has a Markdown renderer");
assert.match(ui, /translationContent\.replaceChildren\(renderMarkdown\(output\)\)/, "only the simple explanation output is rendered as Markdown");
assert.match(ui, /code\.textContent = codeLines\.join\("\\n"\)/, "Markdown code blocks are added as safe text, not interpreted HTML");
new vm.Script(ui, { filename: "reader.js" });

const extensionPath = fileURLToPath(new URL("../index.js", import.meta.url));
const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const cacheRoot = await mkdtemp(path.join(os.tmpdir(), "pdf-reader-agent-smoke-"));
const explainPdfId = `sha256-${"a".repeat(64)}`;
const explainCacheFolder = path.join(cacheRoot, "markdown-cache", explainPdfId);
await mkdir(explainCacheFolder, { recursive: true });
await writeFile(path.join(explainCacheFolder, "1.md"), "# Page 1\n\nSelected passage context.\n", "utf8");
const child = spawn(process.execPath, ["--experimental-loader", "./tests/package-loader.mjs", "./index.js"], {
  cwd: extensionRoot,
  env: { ...process.env, MOCU_EXTENSION_ROOT: cacheRoot },
});
const lines = createInterface({ input: child.stdout });
const messages = [];
const waitFor = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const index = messages.findIndex(predicate);
    if (index >= 0) return messages.splice(index, 1)[0];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the extension protocol request.");
};
lines.on("line", (line) => {
  try { messages.push(JSON.parse(line)); } catch { /* Ignore non-JSON diagnostic output. */ }
});

try {
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "extension.execute",
    params: { command: "translate", input: { text: "Selected words", targetLanguage: "Spanish" }, config: {} },
  }) + "\n");

  const listRequest = await waitFor((message) => message.method === "mocu.agents.list");
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: listRequest.id,
    result: [{ id: "translation-agent-id", name: "Text Translation Agent", description: "Test agent" }],
  }) + "\n");

  const runRequest = await waitFor((message) => message.method === "mocu.agents.run");
  assert.equal(runRequest.params.agentId, "translation-agent-id");
  assert.match(runRequest.params.input, /Spanish/);
  assert.match(runRequest.params.input, /Selected words/);
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: runRequest.id,
    result: { agentId: runRequest.params.agentId, name: "Text Translation Agent", text: "Palabras seleccionadas" },
  }) + "\n");

  const output = await waitFor((message) => message.id === 1);
  if (!output.result.success) throw new Error(`Extension translation command failed: ${output.result.error}`);
  assert.equal(output.result.success, true);
  assert.equal(output.result.output.text, "Palabras seleccionadas");

  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "extension.execute",
    params: { command: "explain", input: { text: "Selected passage", targetLanguage: "Persian", pdfId: explainPdfId, pageCount: 1 }, config: {} },
  }) + "\n");

  const explainListRequest = await waitFor((message) => message.method === "mocu.agents.list");
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: explainListRequest.id,
    result: [{ id: "simplification-agent-id", name: "PDF Markdown Simplification Agent", description: "Test agent" }],
  }) + "\n");

  const explainRunRequest = await waitFor((message) => message.method === "mocu.agents.run");
  assert.equal(explainRunRequest.params.agentId, "simplification-agent-id");
  assert.match(explainRunRequest.params.input, /Selected passage/);
  assert.match(explainRunRequest.params.input, /Persian/);
  assert.match(explainRunRequest.params.input, new RegExp(`markdown-cache[\\\\/]${explainPdfId.replaceAll("-", "\\-")}`));
  assert.match(explainRunRequest.params.input, /1\.md/);
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: explainRunRequest.id,
    result: { agentId: explainRunRequest.params.agentId, name: "PDF Markdown Simplification Agent", text: "A clear explanation." },
  }) + "\n");

  const explainOutput = await waitFor((message) => message.id === 2);
  if (!explainOutput.result.success) throw new Error(`Extension explain command failed: ${explainOutput.result.error}`);
  assert.equal(explainOutput.result.output.text, "A clear explanation.");
} finally {
  child.kill();
  lines.close();
  await rm(cacheRoot, { recursive: true, force: true });
}

console.log("PDF Reader translation and Markdown-backed explanation smoke tests passed, including both saved-agent invocations.");
