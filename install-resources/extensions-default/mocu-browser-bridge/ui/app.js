const $ = (selector) => document.querySelector(selector);
const statusEl = $("#status");
const outputEl = $("#output");
function showStatus(text, kind = "") { statusEl.textContent = text; statusEl.className = `status ${kind}`; }
function showOutput(value) { outputEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2); }
async function invoke(command, input = {}) { return await window.mocu.extension.execute(command, input); }
function tabInput() { const raw = $("#tabId").value.trim(); if (!raw) return {}; const tabId = Number(raw); if (!Number.isInteger(tabId) || tabId < 0) throw new Error("Tab ID must be a non-negative integer."); return { tabId }; }
async function refreshStatus() {
  try {
    const state = await invoke("getStatus");
    showStatus(state.connected ? "Connected: Chrome is ready for agent browser tasks." : state.running ? "Bridge is running; waiting for the Chrome extension." : "Bridge is stopped.", state.connected ? "ok" : "");
    return state;
  } catch (error) { showStatus(`Could not check the bridge: ${error?.message || error}`, "error"); }
}
async function run(command, input = {}) {
  try { showStatus(`Running ${command}…`); const result = await invoke(command, input); showOutput(result); await refreshStatus(); return result; }
  catch (error) { showStatus(`${command} failed: ${error?.message || error}`, "error"); showOutput({ error: error?.message || String(error) }); }
}
$("#start").addEventListener("click", async () => {
  try { const result = await invoke("startBridge"); showOutput(result); await refreshStatus(); }
  catch (error) { showStatus(`Could not start the bridge: ${error?.message || error}`, "error"); }
});
$("#stop").addEventListener("click", async () => { await run("stopBridge"); });
$("#refresh").addEventListener("click", () => { void refreshStatus(); });
$("#open").addEventListener("click", () => { const url = $("#url").value.trim(); void run("openTab", { url: url || "https://www.google.com" }); });
$("#navigate").addEventListener("click", () => { const url = $("#url").value.trim(); if (!url) { showStatus("Enter a destination URL first.", "error"); return; } void run("navigateTab", { ...tabInput(), url }); });
$("#tabs").addEventListener("click", () => { void run("listTabs"); });
$("#read").addEventListener("click", () => { void run("readPage", tabInput()); });
$("#elements").addEventListener("click", () => { void run("listInteractiveElements", { ...tabInput(), limit: 150 }); });
$("#full").addEventListener("click", () => { void run("readPage", { ...tabInput(), includeHtml: true, includeElements: true }); });
$("#fill").addEventListener("click", () => { const selector = $("#selector").value.trim(); if (!selector) { showStatus("Enter a CSS selector first.", "error"); return; } void run("fillElement", { ...tabInput(), selector, value: $("#value").value }); });
$("#click").addEventListener("click", () => { const selector = $("#selector").value.trim(); if (!selector) { showStatus("Enter a CSS selector first.", "error"); return; } void run("clickElement", { ...tabInput(), selector }); });
$("#readElement").addEventListener("click", () => { const selector = $("#selector").value.trim(); if (!selector) { showStatus("Enter a CSS selector first.", "error"); return; } void run("readElement", { ...tabInput(), selector, mode: $("#readMode").value }); });
$("#execute").addEventListener("click", () => { const code = $("#code").value.trim(); if (!code) { showStatus("Enter JavaScript first.", "error"); return; } void run("executeJavaScript", { ...tabInput(), code }); });
async function initialize() {
  try { await invoke("startBridge"); await refreshStatus(); }
  catch (error) { showStatus(`Bridge startup failed: ${error?.message || error}`, "error"); }
}
void initialize();
setInterval(() => { void refreshStatus(); }, 5_000);
