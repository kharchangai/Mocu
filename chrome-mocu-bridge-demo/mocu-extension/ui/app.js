const $ = (selector) => document.querySelector(selector);
const statusEl = $("#status");
const outputEl = $("#output");
const tokenEl = $("#pairToken");
const agentSelect = $("#agents");
let currentToken = "";

function showStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}
function showOutput(value) {
  outputEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
async function invoke(command, input = {}) {
  return await window.mocu.extension.execute(command, input);
}
async function refreshStatus() {
  try {
    const result = await invoke("getStatus");
    const running = Boolean(result?.running);
    const connected = Boolean(result?.connected);
    showStatus(running ? (connected ? "پل روشن است؛ Chrome وصل است." : "پل روشن است؛ منتظر اتصال Chrome…") : "پل خاموش است.", running && connected ? "ok" : "");
    if (result?.lastAgentResult) showOutput(`Agent: ${result.lastAgentResult.agentName}\nعنوان صفحه: ${result.lastAgentResult.title}\nنشانی: ${result.lastAgentResult.url}\n\n${result.lastAgentResult.text}`);
    return result;
  } catch (error) {
    showStatus(`خطا در ارتباط با افزونهٔ مکو: ${error?.message || error}`, "error");
  }
}

$("#start").addEventListener("click", async () => {
  try {
    showStatus("در حال شروع پل محلی…");
    const result = await invoke("startBridge");
    currentToken = result.token || "";
    tokenEl.textContent = currentToken || "رمز دریافت نشد.";
    showStatus(`پل روی ${result.host}:${result.port} روشن شد؛ حالا Chrome را Pair کن.`, "ok");
  } catch (error) { showStatus(`شروع پل ناموفق بود: ${error?.message || error}`, "error"); }
});

$("#stop").addEventListener("click", async () => {
  try {
    await invoke("stopBridge");
    currentToken = "";
    tokenEl.textContent = "پل متوقف شده است.";
    showStatus("پل متوقف شد.");
  } catch (error) { showStatus(`توقف پل ناموفق بود: ${error?.message || error}`, "error"); }
});

$("#refresh").addEventListener("click", () => { void refreshStatus(); });
$("#copy").addEventListener("click", async () => {
  if (!currentToken) { showStatus("اول پل را شروع کن تا رمز ساخته شود.", "error"); return; }
  try {
    await navigator.clipboard.writeText(currentToken);
    showStatus("رمز در clipboard کپی شد.", "ok");
  } catch {
    showStatus("کپی خودکار نشد؛ رمز را با انتخاب متن و Ctrl+C کپی کن.", "error");
  }
});

$("#loadAgents").addEventListener("click", async () => {
  try {
    const agents = await invoke("listAgents");
    agentSelect.replaceChildren();
    if (!Array.isArray(agents) || agents.length === 0) {
      agentSelect.add(new Option("Agent ذخیره‌شده‌ای وجود ندارد", ""));
      showStatus("اول از صفحهٔ Agents مکو یک Agent بساز.", "error");
      return;
    }
    agentSelect.add(new Option("Agent را انتخاب کن…", ""));
    for (const agent of agents) {
      const option = new Option(`${agent.name} — ${agent.description || "بدون توضیح"}`, agent.id);
      agentSelect.add(option);
    }
    showStatus(`${agents.length} Agent پیدا شد. یکی را انتخاب کن.`, "ok");
  } catch (error) { showStatus(`بارگذاری Agentها ناموفق بود: ${error?.message || error}`, "error"); }
});

$("#choose").addEventListener("click", async () => {
  if (!agentSelect.value) { showStatus("یک Agent انتخاب کن.", "error"); return; }
  try {
    const result = await invoke("selectAgent", { agentId: agentSelect.value });
    showStatus(`Agent «${result.name}» انتخاب شد.`, "ok");
  } catch (error) { showStatus(`انتخاب Agent ناموفق بود: ${error?.message || error}`, "error"); }
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    const input = { action };
    if (action !== "readPage") input.selector = $("#selector").value.trim();
    if (action === "fill") input.value = $("#value").value;
    if (action !== "readPage" && !input.selector) { showStatus("برای این فرمان یک CSS selector وارد کن.", "error"); return; }
    try {
      showStatus("در انتظار پاسخ Chrome…");
      const result = await invoke("controlChrome", input);
      showOutput(result);
      showStatus("Chrome پاسخ داد.", "ok");
    } catch (error) { showStatus(`فرمان ناموفق بود: ${error?.message || error}`, "error"); }
  });
});

void refreshStatus();
setInterval(() => { void refreshStatus(); }, 4_000);
