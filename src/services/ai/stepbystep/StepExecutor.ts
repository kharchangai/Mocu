import type { BaseMessage } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { tool as createLangChainTool } from "@langchain/core/tools";
import type { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";

import {
  StepPlanSchema,
  updateStepPlan,
  type StepPlan,
} from "./createStepPlan";
import { buildStepPrompt } from "./buildStepPrompt";
import type { WorkflowStore } from "./workflowStore";
import { dispatchAgentToolActivity } from "../../../chat/services/toolActivity";
import { saveSpecialistSectionMemoryInBackground } from "../agent/specialist-memory";
import { withShortDescription } from "../agent/tool-summaries";

import {
  emptyMemory,
  type ExecutorTurnContext,
  type LogEntry,
  type SendInput,
  type SendResult,
  type StepMemory,
  type StructuredToolLike,
  type WorkflowState,
  type WorkflowStatus,
} from "./types";

const MemorySchema = z.object({
  outcome: z.string(),
  decisions: z.array(z.string()),
  artifacts: z.array(z.string()),
  openItems: z.array(z.string()),
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function buildMessagesFromStepHistory(entries: LogEntry[]): BaseMessage[] {
  const messages: BaseMessage[] = [];

  for (const entry of entries) {
    const data = asRecord(entry.data);

    if (entry.kind === "user" && typeof data.message === "string") {
      messages.push(new HumanMessage(data.message));
    } else if (entry.kind === "assistant" && typeof data.reply === "string") {
      messages.push(new AIMessage(data.reply));
    } else if (entry.kind === "tool_call") {
      const callId = typeof data.callId === "string" ? data.callId : entry.id;
      const name = typeof data.name === "string" ? data.name : "workflow_tool";
      messages.push(new AIMessage({
        content: "",
        tool_calls: [{
          id: callId,
          name,
          args: asRecord(data.arguments),
          type: "tool_call",
        }],
      }));
    } else if (entry.kind === "tool_result") {
      const callId = typeof data.callId === "string" ? data.callId : entry.id;
      const content = typeof data.result === "string"
        ? data.result
        : JSON.stringify(data.result ?? "");
      messages.push(new ToolMessage({
        content,
        tool_call_id: callId,
        ...(typeof data.name === "string" ? { name: data.name } : {}),
      }));
    } else if (entry.kind === "error") {
      messages.push(new HumanMessage(
        `[Workflow error] ${typeof data.message === "string" ? data.message : JSON.stringify(data)}`,
      ));
    }
  }

  return messages;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isToolErrorResult(result: string): boolean {
  try {
    const parsed: unknown = JSON.parse(result);

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (("ok" in parsed && parsed.ok === false) || "error" in parsed)
    );
  } catch {
    return false;
  }
}

function messageText(message: BaseMessage): string {
  const content = message.content;

  if (typeof content === "string") {
    return content;
  }

  try {
    return JSON.stringify(content);
  } catch {
    return "";
  }
}

export interface StepExecutorOptions {
  /**
   * Builds the tool-calling LLM for a turn. Honors the chat composer's
   * model override and falls back to the configured expensive tier.
   */
  buildTurnLlm: (selectedModel?: string) => Promise<ChatOpenAI>;
  /** Builds the cheap LLM used to write the concise per-step summary. */
  buildSummaryLlm: () => Promise<ChatOpenAI>;
  maxToolRounds?: number;
}

/**
 * Runs an interactive step-by-step workflow.
 *
 * For every user message the executor:
 * 1. logs the user message in detail,
 * 2. prompts the agent with the overall goal, completed step summaries,
 *    the current step, the next step objective and the recent turns,
 * 3. lets the agent call the main agent's tools plus its workflow tools,
 *    logging every tool call and result to disk,
 * 4. saves the reply and keeps the workflow on the current step until the
 *    user explicitly asks to move on (move_to_next_step) or to exit
 *    (finish_workflow),
 * 5. on a step change, writes a concise summary of the completed step that
 *    is injected into the next step's prompt.
 */
export class StepExecutor {
  private readonly busy = new Set<string>();

  constructor(
    private readonly store: WorkflowStore,
    private readonly options: StepExecutorOptions,
  ) {}

  async start(
    plan: StepPlan,
    chatId: string,
    selectedModel?: string,
    projectPath?: string,
  ): Promise<string> {
    const parsed = StepPlanSchema.parse(plan);

    if (
      !parsed.final_goal.trim() ||
      parsed.steps.length === 0
    ) {
      throw new Error("The plan must contain a goal and steps.");
    }

    const normalizedPlan: StepPlan = {
      ...parsed,
      steps: parsed.steps.map((step, index) => ({
        ...step,
        step_number: index + 1,
      })),
    };

    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const state: WorkflowState = {
      id,
      createdAt: new Date().toISOString(),
      chatId,
      ...(projectPath?.trim() ? { projectPath: projectPath.trim() } : {}),
      ...(selectedModel?.trim()
        ? { selectedModel: selectedModel.trim() }
        : {}),
      plan: normalizedPlan,
      currentStepIndex: 0,
      status: "active",
      memories: {},
      recentTurns: [],
    };

    await this.store.save(state);

    return id;
  }

  async getState(workflowId: string): Promise<WorkflowState> {
    return this.store.load(workflowId);
  }

  async cancel(workflowId: string): Promise<void> {
    if (this.busy.has(workflowId)) {
      throw new Error(
        "Wait for the current turn to finish before cancelling.",
      );
    }

    this.busy.add(workflowId);

    try {
      const state = await this.store.load(workflowId);

      if (state.status !== "active") return;

      await this.finalizeStep(state, "exit");
      await this.store.save(state);
    } finally {
      this.busy.delete(workflowId);
    }
  }

  /**
   * Processes one user message inside the active workflow.
   */
  async send(
    workflowId: string,
    input: SendInput,
    turn: ExecutorTurnContext,
  ): Promise<SendResult> {
    const message = input.message.trim();

    if (!message) {
      throw new Error("The user message cannot be empty.");
    }

    if (this.busy.has(workflowId)) {
      throw new Error(
        "This workflow is already processing a message.",
      );
    }

    this.busy.add(workflowId);

    let state: WorkflowState | undefined;

    try {
      state = await this.store.load(workflowId);

      if (state.status !== "active") {
        throw new Error(`The workflow is ${state.status}.`);
      }

      return await this.executeTurn(state, message, turn);
    } catch (error) {
      if (state) {
        await this.store
          .append(
            state.id,
            state.currentStepIndex + 1,
            "error",
            { message: errorMessage(error) },
          )
          .catch(() => undefined);
      }

      throw error;
    } finally {
      this.busy.delete(workflowId);
    }
  }

  private createWorkflowTools(
    state: WorkflowState,
  ): StructuredToolLike[] {
    const readStepLogs = createLangChainTool(
      async ({ stepNumber, offset, limit, kind }) =>
        this.store.readLogs(
          state.id,
          stepNumber,
          offset ?? 0,
          limit ?? 10,
          kind as never,
        ),
      {
        name: "read_step_logs",
        description:
          "Read paginated previews of the detailed logs recorded for one workflow step. Use this to recall what was done and how.",
        schema: z.object({
          stepNumber: z
            .number()
            .int()
            .positive()
            .describe("The step number whose logs should be read."),
          offset: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Skip this many matching log entries."),
          limit: z
            .number()
            .int()
            .positive()
            .max(20)
            .optional()
            .describe("Maximum entries to return (default 10)."),
          kind: z
            .enum([
              "user",
              "assistant",
              "tool_call",
              "tool_result",
              "summary",
              "transition",
              "error",
            ])
            .optional()
            .describe("Only return entries of this kind."),
        }),
      },
    );

    const readLogEntry = createLangChainTool(
      async ({ logId, offset, length }) =>
        this.store.readLogEntry(
          state.id,
          logId,
          offset ?? 0,
          length ?? 6000,
        ),
      {
        name: "read_log_entry",
        description:
          "Read one full log entry (identified by its log ID from read_step_logs) in bounded slices. Use this when a preview is truncated and you need the exact details of how an earlier action was performed.",
        schema: z.object({
          logId: z.string().min(1).describe("The log entry ID."),
          offset: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Character offset to start reading from."),
          length: z
            .number()
            .int()
            .positive()
            .max(20000)
            .optional()
            .describe("Maximum characters to read (default 6000)."),
        }),
      },
    );

    const readStepMemory = createLangChainTool(
      async ({ stepNumber }) => {
        const step = state.plan.steps[stepNumber - 1];

        if (!step) {
          throw new Error("Step not found.");
        }

        return {
          step,
          memory:
            state.memories[String(stepNumber)] ?? emptyMemory(),
        };
      },
      {
        name: "read_step_memory",
        description:
          "Read a step's definition and its compact summary of what was accomplished.",
        schema: z.object({
          stepNumber: z
            .number()
            .int()
            .positive()
            .describe("The step number to inspect."),
        }),
      },
    );

    const moveToNextStep = createLangChainTool(
      async () => {
        const next = state.plan.steps[state.currentStepIndex + 1];

        return {
          acknowledged: true,
          nextStep: next
            ? {
                step_number: next.step_number,
                title: next.title,
                goal: next.goal,
              }
            : null,
          message: next
            ? "The workflow will advance to the next step when this turn ends. Reply with a short acknowledgement and a one-line preview of the next step. Do not do more work."
            : "This was the last step; the workflow will be completed when this turn ends. Reply with a short closing summary.",
        };
      },
      {
        name: "move_to_next_step",
        description:
          "Move the workflow to the next step. Call this ONLY when the user explicitly asks to move to the next step or says the current step is done. This ends the current turn; afterwards only write a short acknowledgement.",
        schema: z.object({}),
      },
    );

    const updatePlan = createLangChainTool(
      async ({ change_request }) => {
        const currentIndex = state.currentStepIndex;

        const completedSteps = state.plan.steps
          .slice(0, currentIndex)
          .map((step) => {
            const memory =
              state.memories[String(step.step_number)];

            return {
              step_number: step.step_number,
              title: step.title,
              goal: step.goal,
              summary: memory?.outcome ?? "",
            };
          });

        const updated = await updateStepPlan({
          oldPlan: state.plan,
          changeRequest: change_request,
          currentStepNumber: currentIndex + 1,
          completedSteps,
          recentTurns: state.recentTurns.map((turn) => ({
            user: turn.user,
            assistant: turn.assistant,
          })),
        });

        const resume = Math.min(
          Math.max(updated.resume_from_step_number, 1),
          updated.steps.length,
        );

        const oldGoal = state.plan.final_goal;

        state.plan = {
          final_goal: updated.final_goal,
          steps: updated.steps,
        };
        state.currentStepIndex = resume - 1;

        /* Memories of steps before the resume point still describe the
         * finished work; drop the rest so stale summaries never leak
         * into the new steps. */
        const keptMemories: Record<string, StepMemory> = {};

        for (const [key, value] of Object.entries(state.memories)) {
          if (Number(key) < resume) {
            keptMemories[key] = value;
          }
        }

        state.memories = keptMemories;
        state.recentTurns = [];

        await this.store.append(state.id, resume, "transition", {
          action: "plan_updated",
          changeRequest: change_request,
          oldFinalGoal: oldGoal,
          newFinalGoal: updated.final_goal,
          newStepCount: updated.steps.length,
          resumedAtStepNumber: resume,
        });

        await this.store.save(state);

        return {
          acknowledged: true,
          newPlan: {
            final_goal: updated.final_goal,
            steps: updated.steps.map((step) => ({
              step_number: step.step_number,
              title: step.title,
              goal: step.goal,
            })),
            resumed_at_step_number: resume,
          },
          message:
            "The plan was updated and saved. Do NOT execute any work now. The current turn will end after you write a short summary of the new plan (or of what changed) and ask the user how they want to proceed. Work only resumes when the user explicitly asks for it.",
        };
      },
      {
        name: "update_plan",
        description:
          "Recreate the workflow plan from the user's change request plus the old plan and the progress made so far. Call this ONLY when the user explicitly asks to change, update, or recreate the plan (for example 'update the plan', 'add X to the plan', 'replan without Y'). Pass the user's request in their own words. This ends the current turn; afterwards only summarize the new plan briefly and wait for the user. Never execute any work as part of a plan update.",
        schema: z.object({
          change_request: z
            .string()
            .min(1)
            .describe(
              "What the user wants changed about the plan, in their own words. Include all relevant details they gave.",
            ),
        }),
      },
    );

    const finishWorkflow = createLangChainTool(
      async () => ({
        acknowledged: true,
        message:
          "The workflow will be closed when this turn ends. Reply with a brief farewell and a one-line recap of the progress made.",
      }),
      {
        name: "finish_workflow",
        description:
          "End the step-by-step workflow at the user's request (for example 'let's stop here' or 'exit the workflow'). This ends the current turn; afterwards only write a short acknowledgement.",
        schema: z.object({}),
      },
    );

    return [
      readStepLogs,
      readLogEntry,
      readStepMemory,
      moveToNextStep,
      updatePlan,
      finishWorkflow,
    ];
  }

  private async executeTurn(
    state: WorkflowState,
    message: string,
    turn: ExecutorTurnContext,
  ): Promise<SendResult> {
    const stepNumber = state.currentStepIndex + 1;

    const mainTools = turn.tools;
    const workflowTools = this.createWorkflowTools(state);

    const allTools = [...mainTools, ...workflowTools];
    const llmTools = allTools.map(withShortDescription);

    const toolMap = new Map<string, StructuredToolLike>();
    for (const item of allTools) {
      toolMap.set(item.name, item);
    }

    const toolsDescription = llmTools
      .map((item) => `- ${item.name}: ${item.description}`)
      .join("\n");

    const llm = await this.options.buildTurnLlm(turn.selectedModel);
    const llmWithTools =
      llmTools.length > 0 ? llm.bindTools(llmTools) : llm;

    const history = await this.store.readStepHistory(state.id, stepNumber);
    const messages: BaseMessage[] = [
      new SystemMessage(
        buildStepPrompt(state, toolsDescription),
      ),
      ...buildMessagesFromStepHistory(history),
      new HumanMessage(message),
    ];

    await this.store.append(state.id, stepNumber, "user", {
      message,
    });

    const maxRounds = this.options.maxToolRounds ?? 10;
    let advanceRequested = false;
    let finishRequested = false;
    let planUpdateRequested = false;
    let reply = "";

    for (let round = 0; round <= maxRounds; round++) {
      const response: AIMessage = await llmWithTools.invoke(
        messages,
        turn.config,
      );

      const toolCalls = response.tool_calls ?? [];

      if (toolCalls.length === 0) {
        reply = messageText(response).trim();
        break;
      }

      messages.push(response);

      for (const [toolCallIndex, toolCall] of toolCalls.entries()) {
        const toolCallId =
          toolCall.id || `${state.id}-${stepNumber}-${round}-${toolCallIndex}`;
        const toolArgs = toolCall.args ?? {};

        await this.store.append(state.id, stepNumber, "tool_call", {
          callId: toolCallId,
          name: toolCall.name,
          arguments: toolArgs,
        });

        dispatchAgentToolActivity({
          id: toolCallId,
          tool: toolCall.name,
          args: toolArgs,
          status: "running",
          chatId: state.chatId,
        });

        let resultText: string;
        let activityStatus: "done" | "error" = "done";

        try {
          const selectedTool = toolMap.get(toolCall.name);

          if (!selectedTool) {
            throw new Error(
              `Unknown tool "${toolCall.name}".`,
            );
          }

          if (toolCall.name === "move_to_next_step") {
            advanceRequested = true;
          }

          if (toolCall.name === "finish_workflow") {
            finishRequested = true;
          }

          if (toolCall.name === "update_plan") {
            planUpdateRequested = true;
          }

          const output = await selectedTool.invoke(
            toolCall.args ?? {},
            turn.config,
          );

          resultText =
            typeof output === "string"
              ? output
              : JSON.stringify(output);
          if (isToolErrorResult(resultText)) {
            activityStatus = "error";
          }
        } catch (error) {
          activityStatus = "error";
          resultText = JSON.stringify({
            ok: false,
            error: errorMessage(error),
          });
        }

        await this.store.append(state.id, stepNumber, "tool_result", {
          callId: toolCallId,
          name: toolCall.name,
          result: resultText,
        });

        dispatchAgentToolActivity({
          id: toolCallId,
          tool: toolCall.name,
          args: toolArgs,
          result: resultText,
          status: activityStatus,
          chatId: state.chatId,
        });

        messages.push(
          new ToolMessage({
            content: resultText,
            tool_call_id: toolCallId,
            name: toolCall.name,
          }),
        );
      }

      /* A plan update must never trigger execution: end the turn right
       * after the tool call so the agent cannot start working on the new
       * plan without an explicit user request. */
      if (planUpdateRequested) {
        break;
      }

      if (round === maxRounds) {
        // Force a final text reply instead of more tool calls.
        const plainLlm = await this.options.buildTurnLlm(
          turn.selectedModel,
        );

        const finalResponse = await plainLlm.invoke(
          messages,
          turn.config,
        );

        reply = messageText(finalResponse).trim();
      }
    }

    if (planUpdateRequested && !reply) {
      // Force a text-only summary; the model has no tools bound here, so it
      // cannot start executing anything.
      messages.push(
        new HumanMessage(
          "(System note: The plan was just updated. Reply with ONLY a short summary of the new plan or of what changed, and ask the user how they want to proceed. Do not describe work you are about to do and do not perform any actions.)",
        ),
      );

      const plainLlm = await this.options.buildTurnLlm(
        turn.selectedModel,
      );

      const finalResponse = await plainLlm.invoke(
        messages,
        turn.config,
      );

      reply = messageText(finalResponse).trim();
    }

    if (!reply) {
      reply = "I could not produce a response. Could you rephrase that?";
    }

    await this.store.append(state.id, stepNumber, "assistant", {
      reply,
    });

    if (finishRequested) {
      await this.finalizeStep(state, "exit");
    } else if (advanceRequested) {
      await this.finalizeStep(state, "advance");
    } else if (!planUpdateRequested) {
      // After a plan update, recentTurns were already reset by the tool and
      // the workflow is paused at the resumed step until the user asks to
      // continue; keep it that way instead of appending this turn.
      state.recentTurns.push({
        stepNumber,
        user: message,
        assistant: reply,
      });

    }

    await this.store.save(state);

    const status: WorkflowStatus = state.status;
    const advanced = advanceRequested && status === "active";
    const finished = status !== "active";

    return {
      reply,
      status,
      currentStepNumber: state.currentStepIndex + 1,
      advanced,
      finished,
    };
  }

  /**
   * Ends the current step: writes the concise step summary (included in
   * the next step's prompt), logs the transition and advances or closes
   * the workflow.
   */
  private async finalizeStep(
    state: WorkflowState,
    action: "advance" | "exit",
  ): Promise<void> {
    const stepNumber = state.currentStepIndex + 1;
    const isLastStep =
      state.currentStepIndex === state.plan.steps.length - 1;

    const memory = await this.generateStepSummary(state, stepNumber);

    state.memories[String(stepNumber)] = memory;
    await this.store.saveStepMemory(state.id, stepNumber, memory);

    await this.store.append(state.id, stepNumber, "summary", memory);

    saveSpecialistSectionMemoryInBackground({
      sessionType: "step-by-step",
      sessionId: state.id,
      sectionNumber: stepNumber,
      goal: `${state.plan.final_goal} — ${state.plan.steps[stepNumber - 1]?.title ?? "Step"}: ${state.plan.steps[stepNumber - 1]?.goal ?? ""}`,
      summary: memory.outcome,
      decisions: memory.decisions,
      artifacts: memory.artifacts,
      openItems: memory.openItems,
      projectPath: state.projectPath,
      chatId: state.chatId,
    });

    if (action === "exit") {
      state.status = "cancelled";
      await this.store.setChatWorkflow(state.chatId, null);

      await this.store.append(state.id, stepNumber, "transition", {
        action: "workflow_cancelled_by_user",
      });

      return;
    }

    if (isLastStep) {
      state.status = "completed";
      await this.store.setChatWorkflow(state.chatId, null);

      await this.store.append(state.id, stepNumber, "transition", {
        action: "workflow_completed",
      });

      return;
    }

    state.currentStepIndex += 1;
    state.recentTurns = [];

    await this.store.append(state.id, stepNumber, "transition", {
      action: "advanced_to_next_step",
      nextStepNumber: state.currentStepIndex + 1,
      nextStepTitle:
        state.plan.steps[state.currentStepIndex].title,
    });
  }

  /**
   * Writes the concise summary of a finished step from its detailed logs.
   */
  private async generateStepSummary(
    state: WorkflowState,
    stepNumber: number,
  ): Promise<StepMemory> {
    const step = state.plan.steps[stepNumber - 1];

    const fallback: StepMemory = {
      outcome:
        state.recentTurns.length > 0
          ? state.recentTurns[state.recentTurns.length - 1].assistant
          : "",
      decisions: [],
      artifacts: [],
      openItems: [],
    };

    try {
      const logs = await this.store.readStepHistory(state.id, stepNumber);
      const relevantKinds = new Set([
        "user",
        "assistant",
        "tool_call",
        "tool_result",
        "error",
      ]);

      const logText = logs
        .filter((entry) => relevantKinds.has(entry.kind))
        .map((entry) => `[${entry.kind}] ${JSON.stringify(entry.data)}`)
        .join("\n\n");

      if (!logText.trim()) {
        return fallback;
      }

      const summaryLlm = await this.options.buildSummaryLlm();
      const structuredLlm =
        summaryLlm.withStructuredOutput(MemorySchema);

      const result = await structuredLlm.invoke([
        {
          role: "system",
          content: `
Summarize the work completed during one step of a step-by-step workflow.

Rules:
- outcome: what was actually done and what state the work is in now.
- decisions: confirmed decisions relevant to continuing the workflow.
- artifacts: exact useful references (file paths, function names, log IDs).
- openItems: unresolved work, limitations, or uncertainties.
- Distinguish proposed work from completed work. Never invent actions.
- Keep it concise; do not copy raw tool outputs.
- Reply in English.
`.trim(),
        },
        {
          role: "user",
          content: JSON.stringify({
            step: {
              step_number: step.step_number,
              title: step.title,
              goal: step.goal,
            },
            final_goal: state.plan.final_goal,
            detailed_logs: logText,
          }),
        },
      ]);

      if (
        !result ||
        typeof result.outcome !== "string" ||
        !result.outcome.trim()
      ) {
        return fallback;
      }

      return result;
    } catch (error) {
      console.warn(
        "[StepExecutor] Failed to generate the step summary:",
        error,
      );

      return fallback;
    }
  }
}
