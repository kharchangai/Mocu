import { createExtension } from "./vendor/mocu-sdk/dist/index.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// stdout is reserved for the Mocu JSON-RPC protocol.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

const TELEGRAM_API = "https://api.telegram.org";
const MAX_TELEGRAM_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TELEGRAM_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEFAULT_DOWNLOAD_DIRECTORY = path.join(homedir(), ".mocu", "telegram-downloads");
const extension = createExtension({ commands: {} });

// The bot is deliberately started on demand and only lives while Mocu's
// extension process is alive. Conversations are kept in memory, not persisted.
let activeConfig = null;
let pollTask = null;
let stopRequested = false;
let nextOffset = 0;
let authorizedChatId = "";
let allowedUserId = "";
let lastAgentByChat = new Map();
let replyTargetsByChat = new Map();
let historiesByChatAgent = new Map();
let queuedUpdates = Promise.resolve();

function normalizeChatId(value) {
  return String(value ?? "").trim();
}

function normalizeAgentName(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function requireConfig(config) {
  const botToken = String(config?.botToken ?? "").trim();
  const allowedChatId = normalizeChatId(config?.allowedChatId);
  if (!botToken) {
    throw new Error("Telegram bot token is missing. Configure it in Extensions → Telegram Bridge → Settings.");
  }
  if (!/^-?\d+$/.test(allowedChatId)) {
    throw new Error("Allowed Telegram private chat ID is missing or invalid. Set its numeric ID in the extension Settings.");
  }
  const nextConfig = { botToken, allowedChatId, downloadDirectory: String(config?.downloadDirectory ?? "").trim() };
  getDownloadDirectory(nextConfig);
  return nextConfig;
}

function telegramUrl(config, method) {
  return `${TELEGRAM_API}/bot${config.botToken}/${method}`;
}

async function telegramCall(config, method, payload = {}, { signal, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromParent = () => controller.abort();
  signal?.addEventListener("abort", abortFromParent, { once: true });
  try {
    const response = await fetch(telegramUrl(config, method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new Error(`${method}: ${data?.description || `Telegram HTTP ${response.status}`}`);
    }
    return data.result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function getDownloadDirectory(config) {
  const configured = String(config?.downloadDirectory ?? "").trim();
  if (!configured) return DEFAULT_DOWNLOAD_DIRECTORY;
  if (!path.isAbsolute(configured) || configured.includes("\0")) {
    throw new Error("downloadDirectory must be an absolute local folder path.");
  }
  return path.resolve(configured);
}

function getTelegramAttachment(message) {
  if (message.document) return { ...message.document, kind: "document" };
  if (message.video) return { ...message.video, kind: "video" };
  if (message.audio) return { ...message.audio, kind: "audio" };
  if (message.voice) return { ...message.voice, kind: "voice", file_name: "telegram-voice.ogg" };
  if (message.animation) return { ...message.animation, kind: "animation" };
  if (message.video_note) return { ...message.video_note, kind: "video note", file_name: "telegram-video-note.mp4" };
  if (Array.isArray(message.photo) && message.photo.length) {
    return { ...message.photo[message.photo.length - 1], kind: "photo", file_name: `telegram-photo-${message.message_id ?? Date.now()}.jpg` };
  }
  return null;
}

async function downloadTelegramFile(config, attachment) {
  if (!attachment?.file_id) throw new Error("Telegram attachment has no file ID.");
  const metadata = await telegramCall(config, "getFile", { file_id: attachment.file_id });
  const telegramPath = String(metadata?.file_path ?? "");
  if (!telegramPath || telegramPath.includes("\0") || telegramPath.split(/[\\/]/).includes("..")) {
    throw new Error("Telegram returned an invalid file path.");
  }
  if (Number(metadata.file_size ?? attachment.file_size ?? 0) > MAX_TELEGRAM_DOWNLOAD_BYTES) {
    throw new Error("Telegram file is larger than the 20 MB download limit.");
  }
  const encodedPath = telegramPath.split("/").map(encodeURIComponent).join("/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let bytes;
  try {
    const response = await fetch(`${TELEGRAM_API}/file/bot${config.botToken}/${encodedPath}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Telegram file download failed (HTTP ${response.status}).`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_TELEGRAM_DOWNLOAD_BYTES) throw new Error("Telegram file is larger than the 20 MB download limit.");
    bytes = Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
  if (bytes.length > MAX_TELEGRAM_DOWNLOAD_BYTES) throw new Error("Telegram file is larger than the 20 MB download limit.");

  const directory = getDownloadDirectory(config);
  await mkdir(directory, { recursive: true });
  const rawName = path.posix.basename(String(attachment.file_name ?? `telegram-${attachment.kind}` ).replace(/\\/g, "/"));
  const safeName = rawName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "").trim() || "telegram-file";
  const localPath = path.join(directory, `${Date.now()}-${randomUUID()}-${safeName}`);
  await writeFile(localPath, bytes, { flag: "wx" });
  return { localPath, bytes: bytes.length, fileName: safeName };
}

async function sendTelegramDocument(config, chatId, localPath, fileName, caption) {
  const bytes = await readFile(localPath);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", new Blob([bytes]), fileName);
  if (caption) form.append("caption", caption.slice(0, 1024));
  const response = await fetch(telegramUrl(config, "sendDocument"), { method: "POST", body: form });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(`sendDocument: ${data?.description || `Telegram HTTP ${response.status}`}`);
  }
  return data.result;
}

function splitTelegramText(value) {
  const text = String(value ?? "").trim() || "(empty response)";
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += MAX_TELEGRAM_MESSAGE) {
    chunks.push(text.slice(offset, offset + MAX_TELEGRAM_MESSAGE));
  }
  return chunks;
}

async function sendTelegram(config, chatId, text) {
  let lastMessage;
  for (const chunk of splitTelegramText(text)) {
    lastMessage = await telegramCall(config, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
  return lastMessage;
}
async function handleIncomingAttachment(config, message, attachment) {
  const chatId = normalizeChatId(message.chat?.id);
  const downloaded = await downloadTelegramFile(config, attachment);
  const caption = String(message.caption ?? "").trim();
  const filePrompt = [
    `The user sent a Telegram ${attachment.kind} file named "${downloaded.fileName}" (${downloaded.bytes} bytes).`,
    `It has been downloaded to this local path: ${downloaded.localPath}`,
    caption ? `User's caption/instructions: ${caption}` : "No caption was included. Ask the user what they would like done with the file if it is unclear.",
    "Use your available Mocu tools to inspect or process this local file when appropriate.",
  ].join("\n");
  const replyMessageId = message.reply_to_message?.message_id;
  const replyTarget = replyMessageId ? replyTargetsByChat.get(`${chatId}:${replyMessageId}`) : null;
  const identity = replyTarget ?? lastAgentByChat.get(chatId);
  if (!identity) {
    await sendTelegram(config, chatId, `📥 File received and saved to:\n${downloaded.localPath}\n\nChoose an agent with /agents, then send /ask <agent name> <what to do with the file>.`);
    return;
  }
  const { agent } = await findAgent(identity.id);
  if (!agent) {
    await sendTelegram(config, chatId, `File saved to ${downloaded.localPath}, but the saved agent "${identity.name}" is no longer available. Use /agents to choose another.`);
    return;
  }
  await sendTelegram(config, chatId, `📨 File received. Sending it to ${agent.name}…`);
  await runAgentForTelegram(agent, filePrompt, chatId, Boolean(replyTarget));
}

function agentIdentity(agent) {
  return { id: String(agent.id), name: String(agent.name ?? agent.id) };
}

async function getAgents() {
  return extension.agents.list();
}

async function findAgent(query) {
  const text = String(query ?? "").trim();
  const agents = await getAgents();
  const agent = agents.find((item) => String(item.id) === text || normalizeAgentName(item.name) === normalizeAgentName(text));
  return { agents, agent: agent ?? null };
}

function historyKey(chatId, agentId) {
  return `${chatId}:${agentId}`;
}

function getHistory(chatId, agentId) {
  return (historiesByChatAgent.get(historyKey(chatId, agentId)) ?? []).slice(-MAX_HISTORY_ITEMS);
}

function appendHistory(chatId, agentId, userText, agentText) {
  const key = historyKey(chatId, agentId);
  const history = historiesByChatAgent.get(key) ?? [];
  history.push({ user: userText.slice(0, 3000), assistant: String(agentText ?? "").slice(0, 3000) });
  historiesByChatAgent.set(key, history.slice(-MAX_HISTORY_ITEMS));
}

function buildAgentInput(agent, text, chatId, isReply) {
  const history = getHistory(chatId, agent.id);
  const recent = history.map((turn, index) =>
    `Turn ${index + 1}\nUser: ${turn.user}\n${agent.name}: ${turn.assistant}`,
  ).join("\n\n");
  return [
    `You are the saved Mocu agent named "${agent.name}".`,
    "The following message came from the owner of the connected, authorized private Telegram chat.",
    "Respond as this agent and use the tools/extensions already configured for you in Mocu when useful.",
    "Never claim that a tool or action succeeded unless you actually completed it.",
    isReply ? "The user is replying to a Telegram message from you. Continue the same conversation." : "The user contacted you from Telegram. Answer their request directly.",
    recent ? `Recent conversation with this agent:\n${recent}` : "This is the start of this agent's conversation history.",
    `New Telegram message:\n${text}`,
  ].join("\n\n");
}

async function runAgentForTelegram(agent, text, chatId, isReply = false) {
  const config = activeConfig;
  if (!config) throw new Error("Telegram bot is not started. Run the start_bot command in Mocu first.");
  const result = await extension.agents.run({
    agentId: agent.id,
    input: buildAgentInput(agent, text, chatId, isReply),
  });
  const identity = agentIdentity({ id: result.agentId || agent.id, name: result.name || agent.name });
  appendHistory(chatId, agent.id, text, result.text);
  lastAgentByChat.set(chatId, identity);
  replyTargetsByChat.set(chatId, identity);
  const sent = await sendTelegram(config, chatId, `🤖 ${identity.name}\n\n${result.text}`);
  if (sent?.message_id) replyTargetsByChat.set(`${chatId}:${sent.message_id}`, identity);
  return { agent: identity, text: result.text };
}

function formatAgentList(agents) {
  if (!agents.length) return "No saved Mocu agents found. Create an agent in Mocu first.";
  return ["Saved Mocu agents:", ...agents.map((agent) => `• ${agent.name} (id: ${agent.id})`), "", "Use /ask <exact agent name or id> <message> to start a conversation."].join("\n");
}

async function sendHelp(config, chatId) {
  await sendTelegram(config, chatId, [
    "Telegram Bridge commands:",
    "/agents — list saved Mocu agents",
    "/ask <agent name or id> <message> — start or switch agents",
    "/reply <message> — reply to the most recent agent",
    "/continue <message> — continue with the last agent you spoke with",
    "/help — show this help",
    "",
    "You can also reply directly to an agent's Telegram message; that reply is routed back to that agent.",
  ].join("\n"));
}

async function handleCommand(config, message, command, rawArgs) {
  const chatId = normalizeChatId(message.chat?.id);
  const text = String(rawArgs ?? "").trim();
  if (command === "/start" || command === "/help") {
    await sendHelp(config, chatId);
    return;
  }
  if (command === "/agents") {
    await sendTelegram(config, chatId, formatAgentList(await getAgents()));
    return;
  }
  if (command === "/ask") {
    const agents = await getAgents();
    const candidates = [...agents].sort((a, b) => Math.max(String(b.name).length, String(b.id).length) - Math.max(String(a.name).length, String(a.id).length));
    const match = candidates.find((agent) => [String(agent.name), String(agent.id)].some((name) => text.toLocaleLowerCase().startsWith(`${name.toLocaleLowerCase()} `)));
    if (!match) {
      await sendTelegram(config, chatId, "Usage: /ask <exact agent name or id> <message>\nUse /agents to list agents. Names with spaces are supported.");
      return;
    }
    const agent = match;
    const matchedName = [String(agent.name), String(agent.id)].find((name) => text.toLocaleLowerCase().startsWith(`${name.toLocaleLowerCase()} `));
    const prompt = text.slice(matchedName.length).trim();
    if (!prompt) {
      await sendTelegram(config, chatId, "Please add a message after the agent name.");
      return;
    }
    lastAgentByChat.set(chatId, agentIdentity(agent));
    await sendTelegram(config, chatId, `📨 Sending your message to ${agent.name}…`);
    await runAgentForTelegram(agent, prompt, chatId);
    return;
  }
  if (command === "/reply" || command === "/continue") {
    if (!text) {
      await sendTelegram(config, chatId, `Usage: ${command} <message>`);
      return;
    }
    const identity = command === "/reply" ? (replyTargetsByChat.get(chatId) ?? lastAgentByChat.get(chatId)) : lastAgentByChat.get(chatId);
    if (!identity) {
      await sendTelegram(config, chatId, "No recent agent to reply to. Use /agents, then /ask <agent> <message>.");
      return;
    }
    const { agent } = await findAgent(identity.id);
    if (!agent) {
      await sendTelegram(config, chatId, `The saved agent \"${identity.name}\" is no longer available. Use /agents to choose another.`);
      return;
    }
    await sendTelegram(config, chatId, `📨 Sending your reply to ${agent.name}…`);
    await runAgentForTelegram(agent, text, chatId, command === "/reply");
    return;
  }
  await sendTelegram(config, chatId, `Unknown command: ${command}. Send /help to see commands.`);
}

async function handleTelegramMessage(config, message) {
  const chatId = normalizeChatId(message.chat?.id);
  const senderId = normalizeChatId(message.from?.id);
  if (!message.chat || message.chat.type !== "private" || chatId !== config.allowedChatId) return;
  // In a private Telegram chat, Telegram uses the owner's user ID as the chat ID.
  if (!senderId || senderId !== chatId) return;
  if (!allowedUserId) allowedUserId = senderId;
  if (senderId !== allowedUserId) return;

  const rawText = String(message.text ?? message.caption ?? "").trim();
  const attachment = getTelegramAttachment(message);
  if (attachment) {
    await handleIncomingAttachment(config, message, attachment);
    return;
  }
  if (!rawText) {
    await sendTelegram(config, chatId, "I can process text messages. Send /help for commands.");
    return;
  }
  if (rawText.startsWith("/")) {
    const [rawCommand, ...rest] = rawText.split(/\s+/);
    await handleCommand(config, message, rawCommand.split("@")[0].toLowerCase(), rest.join(" "));
    return;
  }

  const replyMessageId = message.reply_to_message?.message_id;
  const replyTarget = replyMessageId ? replyTargetsByChat.get(`${chatId}:${replyMessageId}`) : null;
  const identity = replyTarget ?? lastAgentByChat.get(chatId);
  if (!identity) {
    await sendTelegram(config, chatId, "Choose an agent: send /agents, then /ask <agent name> <message>.");
    return;
  }
  const { agent } = await findAgent(identity.id);
  if (!agent) {
    await sendTelegram(config, chatId, `The saved agent \"${identity.name}\" is no longer available. Use /agents to choose another.`);
    return;
  }
  await sendTelegram(config, chatId, `📨 Sending your message to ${agent.name}…`);
  await runAgentForTelegram(agent, rawText, chatId, Boolean(replyTarget));
}

async function handleUpdate(config, update) {
  const message = update.message ?? update.edited_message;
  if (!message) return;
  try {
    await handleTelegramMessage(config, message);
  } catch (error) {
    console.error("Telegram Bridge update failed:", error instanceof Error ? error.message : String(error));
    if (normalizeChatId(message.chat?.id) === config.allowedChatId) {
      try {
        await sendTelegram(config, config.allowedChatId, `⚠️ I couldn't complete that request: ${error instanceof Error ? error.message : String(error)}`);
      } catch (sendError) {
        console.error("Telegram Bridge error reply failed:", sendError instanceof Error ? sendError.message : String(sendError));
      }
    }
  }
}

async function pollTelegram(config, signal) {
  while (!signal.aborted) {
    try {
      const updates = await telegramCall(config, "getUpdates", {
        offset: nextOffset,
        timeout: 25,
        allowed_updates: ["message", "edited_message"],
      }, { signal, timeoutMs: 35_000 });
      for (const update of updates ?? []) {
        if (Number.isFinite(update.update_id)) nextOffset = update.update_id + 1;
        queuedUpdates = queuedUpdates.then(() => handleUpdate(config, update)).catch((error) => {
          console.error("Telegram Bridge update queue failed:", error instanceof Error ? error.message : String(error));
        });
      }
    } catch (error) {
      if (signal.aborted) break;
      console.error("Telegram Bridge polling error:", error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function discardPendingUpdates(config) {
  // Discard messages sent while the listener was offline; do not unexpectedly
  // replay them as new agent instructions when the bot starts.
  while (true) {
    const updates = await telegramCall(config, "getUpdates", {
      offset: nextOffset,
      limit: 100,
      timeout: 0,
      allowed_updates: ["message", "edited_message"],
    });
    if (!updates?.length) return;
    nextOffset = updates[updates.length - 1].update_id + 1;
    if (updates.length < 100) return;
  }
}

async function stopListener() {
  stopRequested = true;
  const task = pollTask;
  pollTask = null;
  task?.controller.abort();
  if (task?.promise) await task.promise;
  activeConfig = null;
  authorizedChatId = "";
  allowedUserId = "";
  lastAgentByChat.clear();
  replyTargetsByChat.clear();
  historiesByChatAgent.clear();
  queuedUpdates = Promise.resolve();
}

extension.registerCommand("start_bot", async (_input, _context, config) => {
  const nextConfig = requireConfig(config);
  await stopListener();
  const bot = await telegramCall(nextConfig, "getMe");
  const chat = await telegramCall(nextConfig, "getChat", { chat_id: nextConfig.allowedChatId });
  if (chat.type !== "private") throw new Error("The configured chat ID must belong to a private Telegram chat.");
  const agents = await getAgents();
  await discardPendingUpdates(nextConfig);
  activeConfig = nextConfig;
  authorizedChatId = nextConfig.allowedChatId;
  stopRequested = false;
  const controller = new AbortController();
  const promise = pollTelegram(nextConfig, controller.signal).finally(() => {
    if (pollTask?.controller === controller) pollTask = null;
  });
  pollTask = { controller, promise };
  await sendTelegram(nextConfig, nextConfig.allowedChatId, `✅ Telegram Bridge is online as @${bot.username ?? bot.first_name}.\n${agents.length} saved agent(s) available. Send /help to see commands.`);
  return { running: true, botUsername: bot.username ?? null, allowedChatId: authorizedChatId, availableAgents: agents.map(agentIdentity) };
});

extension.registerCommand("stop_bot", async () => {
  await stopListener();
  return { running: false, message: "Telegram listener stopped." };
});

extension.registerCommand("bot_status", async () => ({
  running: Boolean(pollTask && !stopRequested),
  allowedChatId: authorizedChatId || null,
  note: "The bot token is never included in status output.",
}));

extension.registerCommand("list_agents", async () => (await getAgents()).map(agentIdentity));

extension.registerCommand("send_message", async (input) => {
  const config = activeConfig;
  if (!config) throw new Error("Telegram bot is not started. Run the start_bot command in Mocu first.");
  const data = typeof input === "string" ? { message: input } : (input ?? {});
  const message = String(data.message ?? data.text ?? "").trim();
  const agentQuery = String(data.agentName ?? data.agent ?? data.agentId ?? "").trim();
  if (!message) throw new Error("Provide a non-empty message field.");
  if (!agentQuery) throw new Error("Provide the sending agent's exact name or ID in agentName.");
  const { agents, agent } = await findAgent(agentQuery);
  if (!agent) {
    throw new Error(agents.some((candidate) => String(candidate.id) === agentQuery || normalizeAgentName(candidate.name) === normalizeAgentName(agentQuery))
      ? "More than one agent matches. Provide the exact agent ID."
      : `Saved Mocu agent not found: ${agentQuery}`);
  }
  const sent = await sendTelegram(config, config.allowedChatId, `🤖 ${agent.name}\n\n${message}`);
  const identity = agentIdentity(agent);
  lastAgentByChat.set(config.allowedChatId, identity);
  replyTargetsByChat.set(config.allowedChatId, identity);
  if (sent?.message_id) replyTargetsByChat.set(`${config.allowedChatId}:${sent.message_id}`, identity);
  return { sent: true, agent: identity, telegramMessageId: sent?.message_id ?? null };
});

extension.registerCommand("send_file", async (input) => {
  const config = activeConfig;
  if (!config) throw new Error("Telegram bot is not started. Run the start_bot command in Mocu first.");
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Provide filePath and the exact saved agent name or ID in agentName.");
  }
  const filePath = typeof input.filePath === "string" ? input.filePath.trim() : "";
  const agentQuery = String(input.agentName ?? input.agent ?? input.agentId ?? "").trim();
  const captionText = String(input.caption ?? input.message ?? "").trim();
  if (!filePath || filePath.includes("\0") || !path.isAbsolute(filePath)) {
    throw new Error("filePath must be an absolute local file path.");
  }
  if (!agentQuery) throw new Error("Provide the sending agent's exact name or ID in agentName.");
  const { agents, agent } = await findAgent(agentQuery);
  if (!agent) {
    throw new Error(agents.some((candidate) => String(candidate.id) === agentQuery || normalizeAgentName(candidate.name) === normalizeAgentName(agentQuery))
      ? "More than one agent matches. Provide the exact agent ID."
      : `Saved Mocu agent not found: ${agentQuery}`);
  }
  const absolutePath = path.resolve(filePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) throw new Error("filePath must point to a regular file.");
  if (fileStat.size > MAX_TELEGRAM_UPLOAD_BYTES) throw new Error("File exceeds Telegram's 50 MB sendDocument limit.");
  const fileName = path.basename(absolutePath);
  const sent = await sendTelegramDocument(config, config.allowedChatId, absolutePath, fileName, `🤖 ${agent.name}${captionText ? ` — ${captionText}` : ""}`);
  const identity = agentIdentity(agent);
  lastAgentByChat.set(config.allowedChatId, identity);
  replyTargetsByChat.set(config.allowedChatId, identity);
  if (sent?.message_id) replyTargetsByChat.set(`${config.allowedChatId}:${sent.message_id}`, identity);
  return { sent: true, agent: identity, fileName, bytes: fileStat.size, telegramMessageId: sent?.message_id ?? null };
});

process.once("SIGTERM", () => { void stopListener(); });
process.once("SIGINT", () => { void stopListener(); });

extension.start();

