import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { createStepPlan, type StepPlan } from "./createStepPlan";
import { StepExecutor } from "./StepExecutor";
import { WorkflowStore } from "./workflowStore";
import type {
  SendResult,
  StepMemory,
  StructuredToolLike,
  WorkflowState,
} from "./types";

import {
  getAsyncLLM,
  getMainAgentLlm,
  getSelectedChatModel,
} from "../llm";

import { terminalExecutionTool } from "../tools/terminal_execution_tool";
import { perplexitySearchTool } from "../tools/perplexity_search_tool";
import { skillLoaderTool } from "../tools/skill_loader_tool";
import { desktopVisionTool } from "../tools/desktop-vision-tool";
import { scheduleTool } from "../../../schedule/schedule-tool";
import {
  textToSpeechTool,
  speechControlTool,
} from "../tools/text_to_speech_tool";
import { createAgentTool } from "../tools/create_agent_tool";
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  findFileTool,
} from "../tools/filesystem";
import { docTools } from "../tools/docs_tools";
import { notesTools } from "../tools/notes_tools";

import {
  loadExtensionAgentTools,
} from "../../../extensions/services/extension-agent-tools";
import {
  loadMcpAgentTools,
} from "../../../mcp/tool-adapter";
import {
  loadAgentTools,
} from "../../../chat/agent/agent-tools";

/*
 * Shared store and executor -----------------------------------------------
 */

const store = new WorkflowStore();

const executor = new StepExecutor(store, {
  buildTurnLlm: async (selectedModel?: string) =>
    getMainAgentLlm(selectedModel ?? "", {}, "expensive"),
  buildSummaryLlm: () => getAsyncLLM("cheap", { temperature: 0 }),
});

/*
 * Config helpers ------------------------------------------------------------
 */

function getConfigReferences(
  config: RunnableConfig | undefined,
  key: string,
): string[] {
  const value = config?.configurable?.[key];

  /*
   * Most selections are string arrays, but `selectedAgent` is a single
   * agent name string set by the composer.
   */
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

/**
 * Builds the tool runtime for the execution agent.
 *
 * The workflow agent gets the same task tools as the main project agent
 * (file tools, terminal, screen, web, skills, scheduling, speech, agent
 * creation, knowledge docs, notes, extensions, MCP, specialists) plus its
 * own workflow tools. Compact tool summaries keep the prompt small.
 */
async function buildMainAgentToolRuntime(
  config: RunnableConfig,
  projectPath?: string,
): Promise<StructuredToolLike[]> {
  const tools: StructuredToolInterface[] = [
    desktopVisionTool,
    terminalExecutionTool({
      ...(projectPath ? { projectPath } : {}),
    }),
    perplexitySearchTool,
    skillLoaderTool,
    scheduleTool,
    textToSpeechTool,
    speechControlTool,
    createAgentTool,
    readFileTool,
    writeFileTool,
    editFileTool,
    findFileTool,
    ...docTools,
    ...notesTools,
  ];

  const selectedExtensionIds = getConfigReferences(
    config,
    "selectedExtensions",
  );

  try {
    const extensionTools = await loadExtensionAgentTools(
      selectedExtensionIds,
    );

    tools.push(...extensionTools.tools);
  } catch (error) {
    console.warn(
      "[Step Workflow] Failed to load extension tools:",
      error,
    );
  }

  const selectedMcpServerIds = getConfigReferences(
    config,
    "selectedMcpServers",
  );

  try {
    const mcpTools = await loadMcpAgentTools(
      selectedMcpServerIds.map((serverId) => ({ serverId })),
    );

    tools.push(...mcpTools.tools);
  } catch (error) {
    console.warn(
      "[Step Workflow] Failed to load MCP tools:",
      error,
    );
  }

  const selectedAgentNames = getConfigReferences(
    config,
    "selectedAgent",
  );

  try {
    const agentTools = await loadAgentTools(
      selectedAgentNames,
      "",
      config,
    );

    tools.push(...agentTools.tools);
  } catch (error) {
    console.warn(
      "[Step Workflow] Failed to load agent tools:",
      error,
    );
  }

  return tools as StructuredToolLike[];
}

/*
 * Public API ----------------------------------------------------------------
 */

export async function hasActiveStepWorkflow(
  chatId: string,
): Promise<boolean> {
  const workflowId = await store.getChatWorkflow(chatId);

  if (!workflowId) {
    return false;
  }

  try {
    const state = await store.load(workflowId);

    return state.status === "active" && state.chatId === chatId;
  } catch {
    // A missing state file means the workflow is gone.
    await store.setChatWorkflow(chatId, null);

    return false;
  }
}

export async function getActiveStepWorkflow(
  chatId: string,
): Promise<WorkflowState | null> {
  const active = await hasActiveStepWorkflow(chatId);

  if (!active) {
    return null;
  }

  const workflowId = await store.getChatWorkflow(chatId);

  return workflowId ? store.load(workflowId) : null;
}

/**
 * Creates a step-by-step plan from the user's message and the main agent's
 * latest response, then starts the workflow for this chat.
 */
export async function startStepByStepWorkflow(input: {
  chatId: string;
  userMessage: string;
  taskDescription: string;
  selectedModel?: string;
  projectPath?: string;
}): Promise<StepPlan> {
  const plan = await createStepPlan({
    userMessage: input.userMessage,
    agentResponse: input.taskDescription,
  });

  const workflowId = await executor.start(
    plan,
    input.chatId,
    input.selectedModel,
    input.projectPath,
  );

  await store.setChatWorkflow(input.chatId, workflowId);
  await store.append(workflowId, 1, "user", {
    message: input.userMessage,
    workflowStart: true,
  });
  return plan;
}

export async function recordStepWorkflowStartReply(
  chatId: string,
  reply: string,
): Promise<void> {
  const workflowId = await store.getChatWorkflow(chatId);
  if (!workflowId || !reply.trim()) return;

  const state = await store.load(workflowId);
  if (state.chatId !== chatId || state.status !== "active") return;

  await store.append(workflowId, state.currentStepIndex + 1, "assistant", {
    reply,
    workflowStart: true,
  });
}

export async function cancelStepWorkflow(
  chatId: string,
): Promise<void> {
  const workflowId = await store.getChatWorkflow(chatId);

  if (!workflowId) {
    return;
  }

  await executor.cancel(workflowId);
}

/** Reactivates a saved workflow so the user can continue from its last step. */
export async function resumeStepByStepWorkflow(
  chatId: string,
  workflowId?: string,
): Promise<void> {
  if (await hasActiveStepWorkflow(chatId)) {
    throw new Error("A step-by-step workflow is already active in this chat.");
  }

  const ids = workflowId
    ? [workflowId]
    : await store.getChatWorkflowIds(chatId);
  const candidates = await Promise.all(ids.map(async (id) => {
    try {
      return await store.load(id);
    } catch {
      return null;
    }
  }));
  const state = candidates
    .filter((candidate): candidate is WorkflowState => candidate !== null && candidate.chatId === chatId)
    .sort((first, second) => (second.createdAt ?? "").localeCompare(first.createdAt ?? ""))[0];

  if (!state) {
    throw new Error("There is no saved step-by-step workflow to resume.");
  }

  const previousStatus = state.status;
  state.status = "active";
  await store.save(state);
  await store.append(state.id, state.currentStepIndex + 1, "transition", {
    action: "workflow_resumed",
    previousStatus,
  });
  await store.setChatWorkflow(chatId, state.id);
}

/**
 * Routes one user message into the active workflow and returns the
 * execution agent's reply.
 */
export async function handleStepWorkflowMessage(
  chatId: string,
  message: string,
  config: RunnableConfig,
  options: { projectPath?: string } = {},
): Promise<SendResult> {
  const workflowId = await store.getChatWorkflow(chatId);

  if (!workflowId) {
    throw new Error("No active step-by-step workflow for this chat.");
  }

  const state = await store.load(workflowId);

  if (state.status !== "active") {
    await store.setChatWorkflow(chatId, null);

    throw new Error(
      `The step-by-step workflow is ${state.status}.`,
    );
  }

  const configurable = config.configurable;
  const hasSelectedModel =
    configurable !== undefined &&
    Object.prototype.hasOwnProperty.call(configurable, "selectedModel");
  const selectedModel = hasSelectedModel
    ? getSelectedChatModel(config)
    : state.selectedModel?.trim() || "";

  /*
   * The composer includes `selectedModel: null` when the user chooses the
   * configured default. Treat that as an explicit choice, not as a reason to
   * fall back to the model captured when the workflow started.
   */
  if (
    hasSelectedModel &&
    (state.selectedModel?.trim() || "") !== selectedModel
  ) {
    if (selectedModel) {
      state.selectedModel = selectedModel;
    } else {
      delete state.selectedModel;
    }

    await store.save(state);
  }

  const tools = await buildMainAgentToolRuntime(
    config,
    options.projectPath?.trim() || undefined,
  );

  return executor.send(
    workflowId,
    { message },
    {
      config: config as unknown as Record<string, unknown>,
      tools,
      selectedModel: selectedModel || undefined,
    },
  );
}

/**
 * Processes a chat message inside the active step-by-step workflow and
 * wraps the result as an AIMessage for the chat pipeline.
 */
export async function runStepWorkflowTurn(
  chatId: string,
  userMessage: string,
  config: RunnableConfig,
  options: { projectPath?: string } = {},
): Promise<BaseMessage> {
  const result: SendResult = await handleStepWorkflowMessage(
    chatId,
    userMessage,
    config,
    options,
  );

  const response = new AIMessage(result.reply);

  return response;
}

/*
 * UI-facing helpers ---------------------------------------------------------
 */

export interface StepWorkflowHistoryEntry {
  id: string;
  stepNumber: number;
  time: string;
  kind: string;
  data: unknown;
}

export interface StepWorkflowOverview {
  id: string;
  status: WorkflowState["status"];
  finalGoal: string;
  currentStepNumber: number;
  totalSteps: number;
  steps: Array<{
    stepNumber: number;
    title: string;
    summary: string;
    goal: string;
    tips: string[];
    state: "done" | "current" | "pending";
    memory: StepMemory | null;
  }>;
}

/**
 * Compact overview of the workflow of a chat, used by the UI panel.
 */
export async function getStepWorkflowStepHistory(
  chatId: string,
  workflowId: string,
  stepNumber: number,
): Promise<StepWorkflowHistoryEntry[]> {
  if (!(await store.getChatWorkflowIds(chatId)).includes(workflowId)) {
    return [];
  }

  const state = await store.load(workflowId);
  if (state.chatId !== chatId) return [];

  const entries = await store.readStepHistory(workflowId, stepNumber);
  return entries.map((entry) => ({
    id: entry.id,
    stepNumber: entry.stepNumber,
    time: entry.time,
    kind: entry.kind,
    data: entry.data,
  }));
}

export async function getStepWorkflowOverview(
  chatId: string,
): Promise<StepWorkflowOverview | null> {
  let state = await getActiveStepWorkflow(chatId);

  if (!state) {
    const candidates = await Promise.all(
      (await store.getChatWorkflowIds(chatId)).map(async (workflowId) => {
        try {
          return await store.load(workflowId);
        } catch {
          return null;
        }
      }),
    );
    state = candidates
      .filter((candidate): candidate is WorkflowState =>
        candidate !== null && candidate.chatId === chatId,
      )
      .sort((first, second) =>
        (second.createdAt ?? "").localeCompare(first.createdAt ?? ""),
      )[0] ?? null;
  }

  if (!state) {
    return null;
  }

  const currentStepNumber = state.currentStepIndex + 1;

  return {
    id: state.id,
    status: state.status,
    finalGoal: state.plan.final_goal,
    currentStepNumber,
    totalSteps: state.plan.steps.length,
    steps: state.plan.steps.map((step) => ({
      stepNumber: step.step_number,
      title: step.title,
      summary: step.summary,
      goal: step.goal,
      tips: step.tips,
      state:
        step.step_number < currentStepNumber ||
        (state.status === "completed" && step.step_number === currentStepNumber)
          ? "done"
          : step.step_number === currentStepNumber
            ? "current"
            : "pending",
      memory: state.memories[String(step.step_number)] ?? null,
    })),
  };
}

export interface StepWorkflowLogPage {
  entries: Array<{
    id: string;
    workflowId: string;
    stepNumber: number;
    time: string;
    kind: string;
    preview: string;
    truncated: boolean;
  }>;
  nextOffset: number | null;
}

/**
 * Reads the detailed workflow logs for the log viewer.
 * Pass `stepNumber = null` to read logs of all steps.
 */
export async function getStepWorkflowLogs(
  chatId: string,
  stepNumber: number | null,
  offset = 0,
  limit = 20,
): Promise<StepWorkflowLogPage> {
  const workflowIds = await store.getChatWorkflowIds(chatId);
  if (workflowIds.length === 0) {
    return { entries: [], nextOffset: null };
  }

  const pages = await Promise.all(
    workflowIds.map(async (workflowId) => {
      const entries: Array<{
        id: string;
        stepNumber?: number;
        time: string;
        kind: string;
        preview: string;
        truncated: boolean;
      }> = [];
      let offset = 0;

      while (true) {
        const page = stepNumber === null
          ? await store.readAllLogs(workflowId, offset, 400)
          : await store.readLogs(workflowId, stepNumber, offset, 20);
        entries.push(...page.entries);
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }

      return { entries: entries.map((entry) => ({ ...entry, workflowId })) };
    }),
  );
  const entries = pages
    .flatMap((page) => page.entries)
    .sort((first, second) =>
      first.time.localeCompare(second.time) || first.id.localeCompare(second.id),
    );
  const pageSize = Math.max(limit, 1);
  const start = Math.max(offset, 0);
  const page = entries.slice(start, start + pageSize);

  return {
    entries: page.map((entry) => ({
      id: entry.id,
      workflowId: entry.workflowId,
      stepNumber: (entry as { stepNumber?: number }).stepNumber ?? 0,
      time: entry.time,
      kind: entry.kind,
      preview: entry.preview,
      truncated: entry.truncated,
    })),
    nextOffset: start + page.length < entries.length ? start + page.length : null,
  };
}

export async function getStepWorkflowLogEntry(
  chatId: string,
  logId: string,
  offset = 0,
  length = 6000,
  requestedWorkflowId?: string,
): Promise<{ text: string; nextOffset: number | null }> {
  const chatWorkflowIds = await store.getChatWorkflowIds(chatId);
  const workflowIds = requestedWorkflowId
    ? chatWorkflowIds.filter((workflowId) => workflowId === requestedWorkflowId)
    : chatWorkflowIds;

  for (const workflowId of workflowIds) {
    try {
      return await store.readLogEntry(workflowId, logId, offset, length);
    } catch {
      // Search the next workflow associated with this conversation.
    }
  }

  return { text: "", nextOffset: null };
}
