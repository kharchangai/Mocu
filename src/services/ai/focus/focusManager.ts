import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { getAsyncLLM, getMainAgentLlm, getSelectedChatModel } from "../llm";
import { desktopVisionTool } from "../tools/desktop-vision-tool";
import { terminalExecutionTool } from "../tools/terminal_execution_tool";
import { perplexitySearchTool } from "../tools/perplexity_search_tool";
import { skillLoaderTool } from "../tools/skill_loader_tool";
import { scheduleTool } from "../../../schedule/schedule-tool";
import { textToSpeechTool, speechControlTool } from "../tools/text_to_speech_tool";
import { createAgentTool } from "../tools/create_agent_tool";
import { readFileTool, writeFileTool, editFileTool, findFileTool } from "../tools/filesystem";
import { docTools } from "../tools/docs_tools";
import { notesTools } from "../tools/notes_tools";
import { loadExtensionAgentTools } from "../../../extensions/services/extension-agent-tools";
import { loadMcpAgentTools } from "../../../mcp/tool-adapter";
import { loadAgentTools } from "../../../chat/agent/agent-tools";

import { FocusExecutor } from "./FocusExecutor";
import { FocusStore } from "./focusStore";
export { parseFocusStartGoal } from "./focusCommand";
import type { FocusLogEntry, FocusMemory, FocusState, FocusToolLike, FocusTurnResult } from "./types";

const store = new FocusStore();
const executor = new FocusExecutor(store, {
  buildTurnLlm: async (selectedModel?: string) => getMainAgentLlm(selectedModel ?? "", {}, "expensive"),
  buildSummaryLlm: () => getAsyncLLM("cheap", { temperature: 0 }),
});

function references(config: RunnableConfig | undefined, key: string): string[] {
  const value = config?.configurable?.[key];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

/** Same task tools as the main project agent, plus the Focus control tools. */
async function buildTaskTools(config: RunnableConfig, projectPath?: string): Promise<FocusToolLike[]> {
  const tools: FocusToolLike[] = [
    desktopVisionTool as FocusToolLike,
    terminalExecutionTool(projectPath ? { projectPath } : {}) as FocusToolLike,
    perplexitySearchTool as FocusToolLike,
    skillLoaderTool as FocusToolLike,
    scheduleTool as FocusToolLike,
    textToSpeechTool as FocusToolLike,
    speechControlTool as FocusToolLike,
    createAgentTool as FocusToolLike,
    readFileTool as FocusToolLike,
    writeFileTool as FocusToolLike,
    editFileTool as FocusToolLike,
    findFileTool as FocusToolLike,
    ...(docTools as unknown as FocusToolLike[]),
    ...(notesTools as unknown as FocusToolLike[]),
  ];
  const extensionIds = references(config, "selectedExtensions");
  try {
    const extensions = await loadExtensionAgentTools(extensionIds);
    tools.push(...extensions.tools as FocusToolLike[]);
  } catch (error) {
    console.warn("[Focus] Could not load selected extension tools:", error);
  }
  const serverIds = references(config, "selectedMcpServers");
  try {
    const mcp = await loadMcpAgentTools(serverIds.map((serverId) => ({ serverId })));
    tools.push(...mcp.tools as FocusToolLike[]);
  } catch (error) {
    console.warn("[Focus] Could not load selected MCP tools:", error);
  }
  const agentNames = references(config, "selectedAgent");
  try {
    const agents = await loadAgentTools(agentNames, "", config);
    tools.push(...agents.tools as FocusToolLike[]);
  } catch (error) {
    console.warn("[Focus] Could not load selected agent tools:", error);
  }
  return tools;
}

export async function hasActiveFocusSession(chatId: string): Promise<boolean> {
  const id = await store.getChatFocus(chatId);
  if (!id) return false;
  try {
    const state = await store.load(id);
    return state.chatId === chatId && state.status === "active";
  } catch {
    await store.setChatFocus(chatId, null);
    return false;
  }
}

export async function getActiveFocusSession(chatId: string): Promise<FocusState | null> {
  if (!(await hasActiveFocusSession(chatId))) return null;
  const id = await store.getChatFocus(chatId);
  return id ? store.load(id) : null;
}

export async function startFocusSession(input: {
  chatId: string;
  goal: string;
  selectedModel?: string;
  projectPath?: string;
}): Promise<FocusState> {
  if (await hasActiveFocusSession(input.chatId)) throw new Error("Focus is already active in this chat.");
  return executor.start(input);
}

export async function cancelFocusSession(chatId: string): Promise<void> {
  await executor.cancel(chatId);
}

/** Reactivates a saved Focus session so the user can continue its goal. */
export async function resumeFocusSession(chatId: string, focusId?: string): Promise<void> {
  if (await hasActiveFocusSession(chatId)) {
    throw new Error("A Focus session is already active in this chat.");
  }

  const ids = focusId ? [focusId] : await store.getChatSessionIds(chatId);
  const candidates = await Promise.all(ids.map(async (id) => {
    try { return await store.load(id); } catch { return null; }
  }));
  const state = candidates
    .filter((candidate): candidate is FocusState => candidate !== null && candidate.chatId === chatId)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))[0];

  if (!state) throw new Error("There is no saved Focus session to resume.");

  const previousStatus = state.status;
  state.status = "active";
  await store.save(state);
  await store.append(state.id, state.currentSectionNumber, "transition", {
    action: "focus_resumed",
    previousStatus,
  });
  await store.setChatFocus(chatId, state.id);
}

export async function handleFocusMessage(chatId: string, message: string, config: RunnableConfig, options: { projectPath?: string } = {}): Promise<FocusTurnResult> {
  const id = await store.getChatFocus(chatId);
  if (!id) throw new Error("There is no active Focus session in this chat.");
  const state = await store.load(id);
  if (state.chatId !== chatId || state.status !== "active") {
    await store.setChatFocus(chatId, null);
    throw new Error("The Focus session is no longer active.");
  }
  const configurable = config.configurable;
  const hasExplicitModel = configurable !== undefined && Object.prototype.hasOwnProperty.call(configurable, "selectedModel");
  const selectedModel = hasExplicitModel ? getSelectedChatModel(config) : state.selectedModel ?? "";
  const tools = await buildTaskTools(config, state.projectPath || options.projectPath?.trim());
  return executor.send(id, message, {
    config: config as unknown as Record<string, unknown>,
    tools,
    selectedModel: selectedModel || undefined,
  });
}

export async function startFocusFromRequest(input: {
  chatId: string;
  userMessage: string;
  goal: string;
  config: RunnableConfig;
  projectPath?: string;
}): Promise<BaseMessage> {
  const selectedModel = getSelectedChatModel(input.config);
  await startFocusSession({
    chatId: input.chatId,
    goal: input.goal,
    selectedModel,
    projectPath: input.projectPath,
  });
  const result = await handleFocusMessage(input.chatId, input.userMessage, input.config, { projectPath: input.projectPath });
  return new AIMessage({ content: result.reply, additional_kwargs: { mocuFocus: true } });
}

export async function runFocusTurn(chatId: string, userMessage: string, config: RunnableConfig, options: { projectPath?: string } = {}): Promise<BaseMessage> {
  const result = await handleFocusMessage(chatId, userMessage, config, options);
  return new AIMessage({ content: result.reply, additional_kwargs: { mocuFocus: true } });
}

export interface FocusChatTurn {
  focusId: string;
  sectionNumber: number;
  time: string;
  message: string;
}

export interface FocusOverview {
  id: string;
  goal: string;
  status: FocusState["status"];
  currentSectionNumber: number;
  createdAt: string;
  sections: Array<{ sectionNumber: number; memory: FocusMemory | null; isCurrent: boolean }>;
}

export async function getFocusOverview(chatId: string): Promise<FocusOverview | null> {
  const active = await getActiveFocusSession(chatId);
  const state = active ?? (await Promise.all((await store.getChatSessionIds(chatId)).map(async (id) => {
    try { return await store.load(id); } catch { return null; }
  }))).filter((item): item is FocusState => item !== null && item.chatId === chatId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  if (!state) return null;
  const lastSection = Math.max(state.currentSectionNumber, ...Object.keys(state.memories).map(Number), 1);
  return {
    id: state.id,
    goal: state.goal,
    status: state.status,
    currentSectionNumber: state.currentSectionNumber,
    createdAt: state.createdAt,
    sections: Array.from({ length: lastSection }, (_, index) => {
      const sectionNumber = index + 1;
      return { sectionNumber, memory: state.memories[String(sectionNumber)] ?? null, isCurrent: state.status === "active" && sectionNumber === state.currentSectionNumber };
    }),
  };
}

export async function getFocusSectionHistory(chatId: string, focusId: string, sectionNumber: number): Promise<FocusLogEntry[]> {
  if (!(await store.getChatSessionIds(chatId)).includes(focusId)) return [];
  const state = await store.load(focusId);
  if (state.chatId !== chatId || sectionNumber < 1 || sectionNumber > state.currentSectionNumber) return [];
  return store.readSectionHistory(focusId, sectionNumber);
}

export async function getFocusHistoryEntry(
  chatId: string,
  focusId: string,
  sectionNumber: number,
  entryId: string,
  offset = 0,
  length = 6000,
): Promise<{ text: string; nextOffset: number | null }> {
  const entries = await getFocusSectionHistory(chatId, focusId, sectionNumber);
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return { text: "", nextOffset: null };

  const text = JSON.stringify(entry.data, null, 2) ?? "null";
  const start = Math.max(0, offset);
  const size = Math.min(Math.max(length, 1), 20000);
  return {
    text: text.slice(start, start + size),
    nextOffset: start + size < text.length ? start + size : null,
  };
}

/** User turns from saved Focus sessions, used to annotate their chat messages. */
export async function getFocusChatTurns(chatId: string): Promise<FocusChatTurn[]> {
  const ids = await store.getChatSessionIds(chatId);
  const turns: FocusChatTurn[] = [];

  for (const focusId of ids) {
    let state: FocusState;
    try {
      state = await store.load(focusId);
    } catch {
      continue;
    }
    if (state.chatId !== chatId) continue;

    for (let sectionNumber = 1; sectionNumber <= state.currentSectionNumber; sectionNumber += 1) {
      const entries = await store.readSectionHistory(focusId, sectionNumber);
      for (const entry of entries) {
        if (entry.kind !== "user" || !entry.data || typeof entry.data !== "object") continue;
        const message = (entry.data as { message?: unknown }).message;
        if (typeof message !== "string" || !message.trim()) continue;
        turns.push({ focusId, sectionNumber, time: entry.time, message });
      }
    }
  }

  return turns.sort((first, second) => first.time.localeCompare(second.time));
}

export async function getFocusHistoryPage(chatId: string, sectionNumber: number, offset = 0, limit = 20) {
  const id = await store.getChatFocus(chatId);
  if (!id) {
    const ids = await store.getChatSessionIds(chatId);
    const latest = await Promise.all(ids.map(async (sessionId) => {
      try { return await store.load(sessionId); } catch { return null; }
    }));
    const state = latest.filter((item): item is FocusState => item !== null && item.chatId === chatId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!state) return { entries: [], nextOffset: null };
    return store.readHistory(state.id, sectionNumber, offset, limit);
  }
  return store.readHistory(id, sectionNumber, offset, limit);
}
