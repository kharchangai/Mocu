import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const backend = await readFile(new URL("../index.js", import.meta.url), "utf8");
const html = await readFile(new URL("../ui/index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../ui/reader.js", import.meta.url), "utf8");

assert.deepEqual(manifest.permissions, ["agents.invoke"]);
assert.ok(manifest.commands.some((command) => command.id === "translate"));
assert.match(backend, /Text Translation Agent/);
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
assert.match(ui, /window\.mocu\.extension\.execute\(commandId, \{ text, targetLanguage \}\)/, "selected-text actions invoke their extension command with the chosen language");
assert.match(ui, /selectedTextForTranslation/);
assert.match(ui, /selectedTextDirection = getTextDirection\(selectedTextForTranslation\)/, "translation direction follows the selected text script");
assert.match(ui, /translationContent\.dir = selectedTextDirection/, "translation status follows the selected text direction");
assert.match(ui, /translationContent\.dir = getTextDirection\(output\)/, "completed translation direction follows the translated text script");
assert.match(ui, /Script=Arabic[\s\S]*?Script=Hebrew/, "direction detection handles right-to-left scripts");
assert.match(html, /\.translation-content\s*\{[^}]*text-align:\s*start;/, "translation aligns to its text direction");
new vm.Script(ui, { filename: "reader.js" });

const extensionPath = fileURLToPath(new URL("../index.js", import.meta.url));
const extensionRoot = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(process.execPath, [extensionPath], { cwd: extensionRoot });
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
} finally {
  child.kill();
  lines.close();
}

console.log("PDF Reader translation smoke test passed, including the saved-agent invocation protocol.");
