const BRIDGE_URL = "ws://127.0.0.1:38742";
const HEARTBEAT_ALARM = "mocu-browser-bridge-heartbeat";
const MAX_ELEMENTS = 250;
const MAX_TEXT = 60_000;
let socket = null;
let reconnectTimer = null;
let connecting = false;

async function publishStatus(status, message = "") {
  await chrome.storage.local.set({ bridgeStatus: status, bridgeMessage: message });
  try { await chrome.runtime.sendMessage({ type: "bridgeStatus", status, message }); } catch {}
}
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => { void connect(); }, 2_000);
}
async function connect() {
  if (connecting || (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState))) return;
  connecting = true;
  try {
    const ws = new WebSocket(BRIDGE_URL); socket = ws;
    ws.addEventListener("open", () => { connecting = false; });
    ws.addEventListener("message", (event) => { void handleServerMessage(ws, event.data); });
    ws.addEventListener("close", (event) => { connecting = false; if (socket === ws) socket = null; void publishStatus("disconnected", event.reason || "Waiting for the Mocu Browser Bridge App."); scheduleReconnect(); });
    ws.addEventListener("error", () => { connecting = false; void publishStatus("disconnected", "Could not connect. Start the Mocu Browser Bridge App in Mocu."); });
  } catch (error) { connecting = false; await publishStatus("error", String(error?.message || error)); scheduleReconnect(); }
}
function validWebUrl(value) {
  const url = new URL(String(value));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS web pages can be opened or controlled.");
  return url.href;
}
async function getTab(tabId) {
  const tab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id || !tab.url) throw new Error("No accessible browser tab was found.");
  const parsed = new URL(tab.url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Chrome internal pages, extension pages, and the Web Store cannot be controlled.");
  return tab;
}
async function inject(tab, func, args = [], world = "ISOLATED") {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world, func, args });
    return results?.[0]?.result;
  } catch (error) { throw new Error(`Could not access ${new URL(tab.url).hostname}. Reload the page and check Chrome extension site access. ${error?.message || error}`); }
}

async function runAction(action) {
  if (action.action === "openTab") {
    const url = action.url ? validWebUrl(action.url) : "https://www.google.com";
    const tab = await chrome.tabs.create({ url, active: action.active !== false });
    return { tabId: tab.id, url: tab.url || url, active: tab.active };
  }
  if (action.action === "listTabs") {
    const tabs = await chrome.tabs.query({});
    return tabs.map((tab) => ({ tabId: tab.id, title: (tab.title || "").slice(0, 500), url: (tab.url || "").slice(0, 2_000), active: Boolean(tab.active), windowId: tab.windowId }));
  }
  if (action.action === "navigateTab") {
    const url = validWebUrl(action.url);
    const tab = Number.isInteger(action.tabId) ? await chrome.tabs.get(action.tabId) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!tab?.id) throw new Error("No browser tab was found to navigate.");
    await chrome.tabs.update(tab.id, { url }); return { tabId: tab.id, url };
  }
  const tab = await getTab(action.tabId);
  if (action.action === "readPage") {
    return await inject(tab, (options) => {
      const text = document.body?.innerText || "";
      const result = { title: document.title, url: location.href, text: text.slice(0, options.maxText), textTruncated: text.length > options.maxText };
      const visible = (element) => { const style = getComputedStyle(element), rect = element.getBoundingClientRect(); return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0; };
      const selectorFor = (element) => { const parts = []; let current = element; while (current && current instanceof Element && current !== document.documentElement) { if (current.id) { const id = `#${CSS.escape(current.id)}`; if (document.querySelector(id) === current) { parts.unshift(id); return parts.join(" > "); } } let part = current.localName; const parent = current.parentElement; if (parent) { const siblings = Array.from(parent.children).filter((child) => child.localName === current.localName); if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`; } parts.unshift(part); current = parent; } return parts.join(" > "); };
      const describe = (element) => { const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" ").trim() : ""; return { selector: selectorFor(element), tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "", type: element.getAttribute("type") || "", label: (labels || element.getAttribute("aria-label") || element.getAttribute("title") || "").slice(0, 300), text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300), name: (element.getAttribute("name") || "").slice(0, 200), placeholder: (element.getAttribute("placeholder") || "").slice(0, 200), href: element instanceof HTMLAnchorElement ? element.href.slice(0, 1000) : "", value: "value" in element ? String(element.value).slice(0, 300) : "", disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true") }; };
      const selector = 'a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"]';
      if (options.includeHtml) { const html = document.documentElement?.outerHTML || ""; result.html = html.slice(0, options.maxHtml); result.htmlTruncated = html.length > options.maxHtml; }
      if (options.includeElements) { const candidates = Array.from(document.querySelectorAll(selector)).filter(visible); result.elements = candidates.slice(0, options.limit).map(describe); result.elementsTruncated = candidates.length > result.elements.length; }
      return result;
    }, [{ includeHtml: action.includeHtml === true, includeElements: action.includeElements === true, maxText: MAX_TEXT, maxHtml: 250_000, limit: MAX_ELEMENTS }]);
  }
  if (action.action === "listInteractiveElements") {
    return await inject(tab, (limit) => {
      const elements = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[contenteditable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"]'));
      const visible = elements.filter((e) => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return e.getClientRects().length && r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0; });
      const selectorFor = (element) => { const parts = []; let current = element; while (current && current instanceof Element && current !== document.documentElement) { if (current.id) { const id = `#${CSS.escape(current.id)}`; if (document.querySelector(id) === current) { parts.unshift(id); return parts.join(" > "); } } let part = current.localName, parent = current.parentElement; if (parent) { const siblings = Array.from(parent.children).filter((child) => child.localName === current.localName); if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`; } parts.unshift(part); current = parent; } return parts.join(" > "); };
      const items = visible.slice(0, limit).map((element) => { const labels = element.labels ? Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" ").trim() : ""; return { selector: selectorFor(element), tag: element.tagName.toLowerCase(), role: element.getAttribute("role") || "", type: element.getAttribute("type") || "", label: (labels || element.getAttribute("aria-label") || element.getAttribute("title") || "").slice(0, 300), text: (element.innerText || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300), name: (element.getAttribute("name") || "").slice(0, 200), placeholder: (element.getAttribute("placeholder") || "").slice(0, 200), value: "value" in element ? String(element.value).slice(0, 300) : "", href: element instanceof HTMLAnchorElement ? element.href.slice(0, 1000) : "", disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true") }; });
      return { title: document.title, url: location.href, elements: items, totalVisible: visible.length, elementsTruncated: visible.length > items.length };
    }, [Math.min(MAX_ELEMENTS, Math.max(1, Number(action.limit) || 100))]);
  }
  if (action.action === "readElement") {
    return await inject(tab, (selector, index, mode, attribute) => {
      let elements; try { elements = document.querySelectorAll(selector); } catch { throw new Error("Invalid CSS selector."); }
      const element = elements[index]; if (!element) throw new Error(`No element at index ${index} matches the selector.`);
      const text = (element.innerText || element.textContent || "").slice(0, 20_000), value = "value" in element ? String(element.value).slice(0, 10_000) : null;
      if (mode === "text") return { text }; if (mode === "value") return { value };
      if (mode === "html") return { html: element.outerHTML.slice(0, 30_000) };
      if (mode === "attribute") { if (!attribute || attribute.length > 200) throw new Error("Provide an attribute name."); return { attribute: element.getAttribute(attribute) }; }
      return { tag: element.tagName.toLowerCase(), text, value, attributes: Array.from(element.attributes).slice(0, 40).reduce((out, item) => { out[item.name] = item.value.slice(0, 2_000); return out; }, {}) };
    }, [String(action.selector), Math.max(0, Number(action.index) || 0), ["text", "value", "html", "attribute"].includes(action.mode) ? action.mode : "summary", String(action.attribute || "")]);
  }
  if (action.action === "clickElement") {
    return await inject(tab, (selector, index) => { let elements; try { elements = document.querySelectorAll(selector); } catch { throw new Error("Invalid CSS selector."); } const element = elements[index]; if (!element) throw new Error(`No element at index ${index} matches the selector.`); if (!(element instanceof HTMLElement)) throw new Error("The selected element cannot be clicked."); if (element.matches(":disabled,[aria-disabled='true']")) throw new Error("The selected element is disabled."); element.click(); return { performed: "click", tag: element.tagName.toLowerCase(), text: (element.innerText || element.textContent || "").trim().slice(0, 300), selector, index }; }, [String(action.selector), Math.max(0, Number(action.index) || 0)]);
  }
  if (action.action === "fillElement") {
    return await inject(tab, (selector, value) => {
      let element; try { element = document.querySelector(selector); } catch { throw new Error("Invalid CSS selector."); }
      if (!element) throw new Error("No element matches the CSS selector."); if (element.matches(":disabled,[readonly]")) throw new Error("The selected field is disabled or read-only.");
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) { const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype; const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set; setter ? setter.call(element, value) : (element.value = value); element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); }
      else if (element instanceof HTMLSelectElement) { element.value = value; element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); }
      else if (element.isContentEditable) { element.textContent = value; element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })); }
      else throw new Error("The selected element is not an input, textarea, select, or contenteditable field.");
      return { performed: "fill", tag: element.tagName.toLowerCase(), value: "value" in element ? String(element.value).slice(0, 1_000) : element.textContent.slice(0, 1_000) };
    }, [String(action.selector), String(action.value || "").slice(0, 20_000)]);
  }
  if (action.action === "executeJavaScript") {
    return await inject(tab, (code) => {
      let value; try { value = (0, eval)(code); } catch (error) { throw new Error(`JavaScript execution failed: ${error?.message || error}`); }
      if (value && typeof value.then === "function") return value.then((resolved) => JSON.parse(JSON.stringify(resolved ?? null))).catch((error) => { throw new Error(`JavaScript promise rejected: ${error?.message || error}`); });
      try { return JSON.parse(JSON.stringify(value ?? null)); } catch { throw new Error("The JavaScript result must be JSON-serializable."); }
    }, [String(action.code)], "MAIN");
  }
  throw new Error(`Unsupported browser action: ${action.action}`);
}

async function handleServerMessage(ws, raw) {
  let message; try { message = JSON.parse(raw); } catch { return; }
  if (message.type === "connected") {
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
    await publishStatus("connected", "Chrome is connected to Mocu and ready for browser tasks."); return;
  }
  if (message.type === "heartbeat_ack") return;
  if (message.type === "browser_action") {
    try { const result = await runAction(message.action || {}); ws.send(JSON.stringify({ type: "browser_action_result", requestId: message.requestId, ok: true, result })); }
    catch (error) { ws.send(JSON.stringify({ type: "browser_action_result", requestId: message.requestId, ok: false, error: String(error?.message || error) })); }
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "heartbeat" }));
  else if (alarm.name === HEARTBEAT_ALARM) void connect();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "getBridgeStatus") { void chrome.storage.local.get(["bridgeStatus", "bridgeMessage"]).then(sendResponse); return true; }
  if (message?.type === "reconnect") { if (socket) { socket.close(); socket = null; } void connect().then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) })); return true; }
  return false;
});
chrome.runtime.onStartup.addListener(() => { void connect(); });
chrome.runtime.onInstalled.addListener(() => { void connect(); });
chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
void connect();