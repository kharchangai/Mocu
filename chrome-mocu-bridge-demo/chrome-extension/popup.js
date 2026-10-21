const statusEl = document.getElementById("status");
const tokenInput = document.getElementById("token");
const resultEl = document.getElementById("result");
const pairButton = document.getElementById("pair");
const sendButton = document.getElementById("send");
const allowSiteButton = document.getElementById("allow-site");

function showStatus(status, message) {
  statusEl.textContent = message || (status === "connected" ? "وصل" : "قطع");
  statusEl.style.color = status === "connected" ? "#347348" : "#a33d35";
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "getBridgeStatus" });
  showStatus(state?.bridgeStatus || "disconnected", state?.bridgeMessage || "");
  if (state?.lastAgentResult) renderResult(state.lastAgentResult);
}

function renderResult(message) {
  resultEl.textContent = message.ok
    ? `Agent: ${message.agentName || ""}\n\n${message.text || ""}`
    : `خطا: ${message.error || "Agent پاسخی نداد."}`;
}

pairButton.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) { showStatus("error", "رمز pairing را وارد کن."); return; }
  pairButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "pair", token });
    if (!response?.ok) throw new Error(response?.error || "Pairing ناموفق بود.");
    showStatus("connecting", "درخواست اتصال فرستاده شد؛ کمی صبر کن…");
    setTimeout(refresh, 500);
  } catch (error) { showStatus("error", String(error?.message || error)); }
  finally { pairButton.disabled = false; }
});

allowSiteButton.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    if (!url || !["http:", "https:"].includes(url.protocol)) throw new Error("یک سایت معمولی (HTTP/HTTPS) را در زبانهٔ فعال باز کن.");
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error("دسترسی به این سایت تأیید نشد.");
    showStatus("connected", `اجازهٔ کنترل ${url.hostname} داده شد. اکنون Mocu می‌تواند به صفحهٔ این سایت فرمان محدود بفرستد.`);
  } catch (error) { showStatus("error", String(error?.message || error)); }
});

sendButton.addEventListener("click", async () => {
  sendButton.disabled = true;
  resultEl.textContent = "در حال خواندن صفحه و فرستادن برای Agent…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const url = tab?.url ? new URL(tab.url) : null;
    if (!tab?.id || !url || !["http:", "https:"].includes(url.protocol)) throw new Error("این صفحه قابل‌خواندن نیست؛ یک وب‌سایت معمولی را باز کن.");
    const allowed = await chrome.permissions.contains({ origins: [`${url.origin}/*`] });
    if (!allowed) throw new Error(`ابتدا با دکمهٔ «اجازهٔ کنترل سایت فعلی» به ${url.hostname} دسترسی بده.`);
    const [page] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ title: document.title, url: location.href, text: document.body?.innerText?.slice(0, 12_000) || "" }),
    });
    if (!page?.result?.text?.trim()) throw new Error("متن خوانایی در صفحه پیدا نشد.");
    const sent = await chrome.runtime.sendMessage({ type: "sendPageData", page: page.result });
    if (!sent?.ok) throw new Error(sent?.error || "ارسال انجام نشد.");
    resultEl.textContent = "صفحه فرستاده شد. پاسخ Agent همین‌جا نمایش داده می‌شود؛ پنجره را باز نگه دار.";
  } catch (error) { resultEl.textContent = `خطا: ${error?.message || error}`; }
  finally { sendButton.disabled = false; }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "bridgeStatus") showStatus(message.status, message.message);
  if (message?.type === "agentResult") renderResult(message.result);
});
void refresh();
