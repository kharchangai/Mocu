import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const HOST = "127.0.0.1";
const PORT = 38742;
const CHROME_EXTENSION_ID = "deejghnbijeiknjoalncgpinpdnmiioe";
const MAX_MESSAGE_BYTES = 1_000_000;
const MAX_TIMEOUT_MS = 30_000;
const commandHandlers = new Map();
const extension = {
  registerCommand(command, handler) {
    commandHandlers.set(command, handler);
  },
  start() {
    const reader = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
    reader.on("line", async (line) => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON received." } })}\n`);
        return;
      }
      if (!request || request.method !== "extension.execute" || !("id" in request)) return;
      const params = request.params && typeof request.params === "object" ? request.params : {};
      const handler = commandHandlers.get(params.command);
      let result;
      if (!handler) {
        result = { success: false, error: `Unknown command: ${params.command}` };
      } else {
        try {
          const output = await handler(params.input, params.context ?? {}, params.config ?? {});
          result = { success: true, output: output ?? null };
        } catch (error) {
          result = { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    });
    process.stdin.resume();
  },
};

console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

let server = null;
let chromeClient = null;
let lastError = "";
const pending = new Map();

function send(ws, message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Chrome is not connected. Open the Mocu Browser Bridge App and check its status.");
  ws.send(JSON.stringify(message));
}

function rejectPending(reason) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error(reason));
  }
  pending.clear();
}

async function askChrome(action, timeoutMs = MAX_TIMEOUT_MS) {
  // The first agent call may start this child process before Chrome has reconnected.
  // Allow the companion MV3 service worker a few heartbeat/reconnect cycles.
  const connectDeadline = Date.now() + 40_000;
  while ((!chromeClient || chromeClient.readyState !== WebSocket.OPEN) && Date.now() < connectDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!chromeClient || chromeClient.readyState !== WebSocket.OPEN) {
    throw new Error("Chrome is not connected. Install/enable the companion Chrome extension and open the Mocu Browser Bridge App.");
  }
  const requestId = randomBytes(12).toString("hex");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("Chrome did not answer within 30 seconds. Check that the tab is accessible and try again."));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    try {
      send(chromeClient, { type: "browser_action", requestId, action });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(error);
    }
  });
}

function startServer() {
  if (server) return Promise.resolve({ running: true, host: HOST, port: PORT });
  lastError = "";
  const nextServer = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_MESSAGE_BYTES });
  server = nextServer;

  nextServer.on("connection", (ws, request) => {
    const expectedOrigin = `chrome-extension://${CHROME_EXTENSION_ID}`;
    if (request.headers.origin !== expectedOrigin) {
      ws.close(1008, "Unrecognized Chrome extension origin");
      return;
    }
    if (chromeClient && chromeClient.readyState === WebSocket.OPEN) {
      ws.close(1008, "A Chrome connection is already active");
      return;
    }
    chromeClient = ws;
    send(ws, { type: "connected" });
    console.error("[mocu-browser-bridge] Chrome connected");

    ws.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { ws.close(1007, "Invalid JSON"); return; }
      if (message.type === "heartbeat") {
        send(ws, { type: "heartbeat_ack" });
        return;
      }
      if (message.type === "browser_action_result") {
        const id = String(message.requestId || "");
        const request = pending.get(id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(id);
        if (message.ok) request.resolve(message.result ?? {});
        else request.reject(new Error(String(message.error || "Chrome action failed.")));
      }
    });

    ws.on("close", () => {
      if (chromeClient === ws) {
        chromeClient = null;
        rejectPending("Chrome disconnected from Mocu.");
      }
      console.error("[mocu-browser-bridge] Chrome disconnected");
    });
    ws.on("error", (error) => console.error("[mocu-browser-bridge] WebSocket error:", error.message));
  });

  return new Promise((resolve, reject) => {
    const onListening = () => {
      nextServer.off("error", onError);
      console.error(`[mocu-browser-bridge] Listening on ws://${HOST}:${PORT}`);
      resolve({ running: true, host: HOST, port: PORT });
    };
    const onError = (error) => {
      nextServer.off("listening", onListening);
      if (server === nextServer) server = null;
      lastError = error.message;
      nextServer.close();
      reject(new Error(`Could not start the local Chrome bridge: ${error.message}`));
    };
    nextServer.once("listening", onListening);
    nextServer.once("error", onError);
  });
}

function stopServer() {
  if (!server) return { running: false, connected: false };
  const oldServer = server;
  server = null;
  if (chromeClient) chromeClient.close(1000, "Mocu bridge stopped");
  chromeClient = null;
  rejectPending("The Mocu browser bridge was stopped.");
  oldServer.close();
  return { running: false, connected: false };
}

function validateSelector(input) {
  const selector = typeof input?.selector === "string" ? input.selector.trim() : "";
  if (!selector || selector.length > 1_000) throw new Error("Provide a CSS selector between 1 and 1,000 characters.");
  return selector;
}

async function browserAction(action, timeoutMs) {
  if (!server) await startServer();
  return askChrome(action, timeoutMs);
}

extension.registerCommand("startBridge", async () => await startServer());
extension.registerCommand("stopBridge", async () => stopServer());
extension.registerCommand("getStatus", async () => ({
  running: Boolean(server),
  connected: Boolean(chromeClient && chromeClient.readyState === WebSocket.OPEN),
  host: HOST,
  port: PORT,
  chromeExtensionId: CHROME_EXTENSION_ID,
  error: lastError,
}));
extension.registerCommand("openTab", async (input) => await browserAction({
  action: "openTab",
  url: input?.url,
  active: input?.active !== false,
}));
extension.registerCommand("navigateTab", async (input) => await browserAction({
  action: "navigateTab",
  tabId: input?.tabId,
  url: input?.url,
}));
extension.registerCommand("listTabs", async () => await browserAction({ action: "listTabs" }));
extension.registerCommand("readPage", async (input) => await browserAction({
  action: "readPage",
  tabId: input?.tabId,
  includeHtml: input?.includeHtml === true,
  includeElements: input?.includeElements === true,
}));
extension.registerCommand("listInteractiveElements", async (input) => await browserAction({
  action: "listInteractiveElements",
  tabId: input?.tabId,
  limit: input?.limit,
}));
extension.registerCommand("readElement", async (input) => await browserAction({
  action: "readElement",
  tabId: input?.tabId,
  selector: validateSelector(input),
  index: input?.index,
  mode: input?.mode,
  attribute: input?.attribute,
}));
extension.registerCommand("clickElement", async (input) => await browserAction({
  action: "clickElement",
  tabId: input?.tabId,
  selector: validateSelector(input),
  index: input?.index,
}));
extension.registerCommand("fillElement", async (input) => {
  if (typeof input?.value !== "string" || input.value.length > 20_000) throw new Error("Provide a field value of up to 20,000 characters.");
  return await browserAction({
    action: "fillElement",
    tabId: input?.tabId,
    selector: validateSelector(input),
    value: input.value,
  });
});
extension.registerCommand("executeJavaScript", async (input) => {
  const code = typeof input?.code === "string" ? input.code : "";
  if (!code.trim() || code.length > 20_000) throw new Error("Provide task-specific JavaScript code of up to 20,000 characters.");
  return await browserAction({ action: "executeJavaScript", tabId: input?.tabId, code }, 120_000);
});
extension.start();
void startServer().catch((error) => {
  lastError = error instanceof Error ? error.message : String(error);
  console.error("[mocu-browser-bridge] Automatic local server startup failed:", lastError);
});