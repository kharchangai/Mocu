const BRIDGE_URL = "ws://127.0.0.1:38741";
const HEARTBEAT_MS = 20_000;
let socket = null;
let pairingToken = "";
let reconnectTimer = null;
let heartbeatTimer = null;
let connecting = false;

async function loadToken() {
  const stored = await chrome.storage.local.get(["pairingToken"]);
  pairingToken = typeof stored.pairingToken === "string" ? stored.pairingToken : "";
}

async function publishStatus(status, message = "") {
  await chrome.storage.local.set({ bridgeStatus: status, bridgeMessage: message });
  try { await chrome.runtime.sendMessage({ type: "bridgeStatus", status, message }); } catch {}
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { void connect(); }, 2_000);
}

async function connect() {
  if (connecting) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  await loadToken();
  if (!pairingToken) {
    await publishStatus("disconnected", "در App مکو پل را شروع کن و رمز pairing را وارد کن.");
    return;
  }
  connecting = true;
  try {
    const ws = new WebSocket(BRIDGE_URL);
    socket = ws;
    ws.addEventListener("open", () => {
      connecting = false;
      ws.send(JSON.stringify({ type: "auth", token: pairingToken }));
    });
    ws.addEventListener("message", (event) => { void handleServerMessage(ws, event.data); });
    ws.addEventListener("close", (event) => {
      connecting = false;
      if (socket === ws) socket = null;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      void publishStatus("disconnected", event.reason || "ارتباط قطع شد.");
      scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      connecting = false;
      void publishStatus("error", "اتصال به پل ممکن نشد؛ مطمئن شو Mocu و پل باز هستند.");
    });
  } catch (error) {
    connecting = false;
    await publishStatus("error", String(error?.message || error));
    scheduleReconnect();
  }
}

async function requireGrantedActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) throw new Error("یک صفحهٔ وب معمولی را در زبانهٔ فعال باز کن.");
  const url = new URL(tab.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("این صفحه قابل کنترل نیست؛ Chrome صفحات داخلی را مسدود می‌کند.");
  const granted = await chrome.permissions.contains({ origins: [`${url.origin}/*`] });
  if (!granted) throw new Error(`ابتدا در پنجرهٔ افزونه روی «اجازهٔ کنترل سایت فعلی» بزن (${url.hostname}).`);
  return tab;
}

async function executeBrowserAction(action) {
  const tab = await requireGrantedActiveTab();
  if (action.action === "readPage") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const visible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
        };
        const selectorFor = (element) => {
          const parts = [];
          let current = element;
          while (current && current instanceof Element && current !== document.documentElement) {
            if (current.id) {
              const idSelector = `#${CSS.escape(current.id)}`;
              if (document.querySelector(idSelector) === current) {
                parts.unshift(idSelector);
                return parts.join(" > ");
              }
            }
            let part = current.localName;
            const parent = current.parentElement;
            if (parent) {
              const siblings = Array.from(parent.children).filter((child) => child.localName === current.localName);
              if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            }
            parts.unshift(part);
            current = parent;
          }
          return parts.join(" > ");
        };
        const candidates = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"]')).filter(visible);
        const elements = candidates.slice(0, 120).map((element) => {
          const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" ").trim() : "";
          return {
            selector: selectorFor(element),
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") || "",
            type: element.getAttribute("type") || "",
            label: (labels || element.getAttribute("aria-label") || element.getAttribute("title") || "").slice(0, 300),
            text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300),
            name: (element.getAttribute("name") || "").slice(0, 200),
            placeholder: (element.getAttribute("placeholder") || "").slice(0, 200),
            href: element instanceof HTMLAnchorElement ? element.href.slice(0, 1000) : "",
            disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
          };
        });
        return {
          title: document.title,
          url: location.href,
          text: document.body?.innerText?.slice(0, 12_000) || "",
          elements,
          elementsTruncated: candidates.length > elements.length,
        };
      },
    });
    return result?.result ?? {};
  }

  const selector = String(action.selector || "");
  if (!selector || selector.length > 500) throw new Error("CSS selector نامعتبر است.");
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [action.action, selector, String(action.value || "").slice(0, 10_000)],
    func: (kind, css, value) => {
      let element;
      try { element = document.querySelector(css); } catch { throw new Error("CSS selector نامعتبر است."); }
      if (!element) throw new Error("عنصر پیدا نشد.");
      if (kind === "click") {
        if (!(element instanceof HTMLElement)) throw new Error("عنصر قابل کلیک نیست.");
        element.click();
        return { performed: "click", tag: element.tagName };
      }
      if (kind === "fill") {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
          throw new Error("عنصر ورودی یا قابل ویرایش نیست.");
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          setter ? setter.call(element, value) : (element.value = value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          element.textContent = value;
          element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        }
        return { performed: "fill", tag: element.tagName };
      }
      throw new Error("فرمان پشتیبانی نمی‌شود.");
    },
  });
  return result?.result ?? {};
}

async function handleServerMessage(ws, raw) {
  let message;
  try { message = JSON.parse(raw); } catch { return; }
  if (message.type === "connected") {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
    }, HEARTBEAT_MS);
    await publishStatus("connected", "Chrome به Mocu وصل است.");
    return;
  }
  if (message.type === "agent_result") {
    await chrome.storage.local.set({ lastAgentResult: message });
    try { await chrome.runtime.sendMessage({ type: "agentResult", result: message }); } catch {}
    return;
  }
  if (message.type === "browser_action") {
    try {
      const result = await executeBrowserAction(message.action || {});
      ws.send(JSON.stringify({ type: "browser_action_result", requestId: message.requestId, ok: true, result }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "browser_action_result", requestId: message.requestId, ok: false, error: String(error?.message || error) }));
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "pair") {
    pairingToken = String(message.token || "").trim();
    void chrome.storage.local.set({ pairingToken }).then(() => {
      if (socket) { socket.close(); socket = null; }
      void connect().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    }).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "sendPageData") {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      sendResponse({ ok: false, error: "به Mocu وصل نیستی." });
      return;
    }
    socket.send(JSON.stringify({ type: "page_data", ...message.page }));
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "getBridgeStatus") {
    void chrome.storage.local.get(["bridgeStatus", "bridgeMessage", "lastAgentResult"]).then(sendResponse);
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.runtime.onInstalled.addListener(() => { void connect(); });
void connect();
