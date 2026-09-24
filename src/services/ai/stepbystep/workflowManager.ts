import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";

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
import { createAgentTool } from "../tools/create_agent_tool";
import { desktopVisionTool } from "../tools/desktop-vision-tool";
import { scheduleTool } from "../../../schedule/schedule-tool";
import {
  createDocTool,
  updateDocTool,
  deleteDocTool,
  listDocsTool,
} from "../tools/docs_tools";

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
 * The workflow agent gets access to the same tools the main agent has for
 * the current request (terminal, files, web, skills, extensions, MCP,
 * child agents, ...) plus its own workflow tools, which are added by the
 * StepExecutor itself.
 */
async function buildMainAgentToolRuntime(
  config: RunnableConfig,
  projectPath?: string,
): Promise<StructuredToolLike[]> {
  const tools: StructuredToolInterface[] = [
    scheduleTool,
    desktopVisionTool,
    terminalExecutionTool({
      ...(projectPath ? { projectPath } : {}),
    }),
    perplexitySearchTool,
    skillLoaderTool,
    createAgentTool,
    createDocTool,
    updateDocTool,
    deleteDocTool,
    listDocsTool,
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
}): Promise<StepPlan> {
  const plan = await createStepPlan({
    userMessage: input.userMessage,
    agentResponse: input.taskDescription,
  });

  const workflowId = await executor.start(
    plan,
    input.chatId,
    input.selectedModel,
  );

  await store.setChatWorkflow(input.chatId, workflowId);
  await store.append(workflowId, 1, "user", {
    message: input.userMessage,
    workflowStart: true,
  });

  return plan;
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

/*
 * Main-agent tool -----------------------------------------------------------
 */

const startWorkflowArgsSchema = z.object({
  task_description: z
    .string()
    .min(1)
    .describe(
      "Your latest response that describes the task the user wants to work through step by step.",
    ),
});

/**
 * Creates the tool exposed to the MAIN agent for one chat request.
 *
 * When the user asks to work through a task step by step, the main agent
 * calls this tool with its latest response describing the task. LangChain
 * tool callbacks do not receive the request config, so the chat id and the
 * latest user message are bound at creation time (per request).
 */
export function createStartStepByStepWorkflowTool(options: {
  chatId: string;
  userMessage: string;
  selectedModel?: string;
}): StructuredToolInterface {
  return tool(
    async ({ task_description }) => {
      const chatId = options.chatId;

      if (await hasActiveStepWorkflow(chatId)) {
        return [
          "A step-by-step workflow is already active in this chat.",
          "Tell the user to continue with the current workflow or to exit it first.",
        ].join(" ");
      }

      const userMessage = options.userMessage.trim();

      if (!userMessage) {
        return "The user message could not be determined; ask the user to repeat the request.";
      }

      try {
        const plan = await startStepByStepWorkflow({
          chatId,
          userMessage,
          taskDescription: task_description,
          selectedModel: options.selectedModel,
        });

        const firstStep = plan.steps[0];

        return [
          `The step-by-step workflow was started with ${plan.steps.length} steps.`,
          `Final goal: ${plan.final_goal}`,
          `Step 1 (${firstStep.title}): ${firstStep.goal}`,
          "Tell the user you created the plan, list the steps briefly, and say you will now start with step 1. Future messages of this chat are handled by the step-by-step workflow.",
        ].join(" ");
      } catch (error) {
        console.error(
          "[Step Workflow] Failed to start the workflow:",
          error,
        );

        return "Failed to create the step-by-step plan. Ask the user to try again.";
      }
    },
    {
      name: "start_step_by_step_workflow",
      description: [
        "Start an interactive step-by-step workflow from the current task.",
        "Call this tool when the user asks to work through a task together, step by step.",
        "Pass your latest response that describes the task; a plan with ordered steps is generated and a dedicated execution agent takes over.",
      ].join(" "),
      schema: startWorkflowArgsSchema,
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
export async function getStepWorkflowOverview(
  chatId: string,
): Promise<StepWorkflowOverview | null> {
  const state = await getActiveStepWorkflow(chatId);

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
        step.step_number < currentStepNumber
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
    workflowIds.map((workflowId) =>
      stepNumber === null
        ? store.readAllLogs(workflowId, 0, 400)
        : store.readLogs(workflowId, stepNumber, 0, 400),
    ),
  );
  const entries = pages
    .flatMap((page) => page.entries)
    .sort((first, second) =>
      first.time.localeCompare(second.time) || first.id.localeCompare(second.id),
    );
  const pageSize = Math.min(Math.max(limit, 1), 400);
  const start = Math.max(offset, 0);
  const page = entries.slice(start, start + pageSize);

  return {
    entries: page.map((entry) => ({
      id: entry.id,
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
): Promise<{ text: string; nextOffset: number | null }> {
  const workflowIds = await store.getChatWorkflowIds(chatId);

  for (const workflowId of workflowIds) {
    try {
      return await store.readLogEntry(workflowId, logId, offset, length);
    } catch {
      // Search the next workflow associated with this conversation.
    }
  }

  return { text: "", nextOffset: null };
}
