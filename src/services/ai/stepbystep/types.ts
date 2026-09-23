import type { BaseMessage } from "@langchain/core/messages";
import type { StepPlan } from "./createStepPlan";

/**
 * Compact summary of the work completed during one step.
 *
 * It is generated when the step is finished (user asks to move on or the
 * workflow ends) and is injected into the prompt of the next step, so the
 * execution agent always knows what has already been done.
 */
export interface StepMemory {
  outcome: string;
  decisions: string[];
  artifacts: string[];
  openItems: string[];
}

export interface ConversationTurn {
  stepNumber: number;
  user: string;
  assistant: string;
}

export type WorkflowStatus = "active" | "completed" | "cancelled";

export interface WorkflowState {
  id: string;
  /** Chat that owns this workflow. Messages from other chats never touch it. */
  chatId: string;
  plan: StepPlan;
  currentStepIndex: number;
  status: WorkflowStatus;
  /** Compact summary per finished step, keyed by step number. */
  memories: Record<string, StepMemory>;
  /** Recent turns of the CURRENT step only. Older details live in the logs. */
  recentTurns: ConversationTurn[];
}

export type LogKind =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "summary"
  | "transition"
  | "error";

export interface LogEntry {
  id: string;
  workflowId: string;
  stepNumber: number;
  time: string;
  kind: LogKind;
  data: unknown;
}

export interface ToolContext {
  workflowId: string;
  stepNumber: number;
}

export interface SendInput {
  message: string;
}

export interface SendResult {
  reply: string;
  status: WorkflowStatus;
  currentStepNumber: number;
  /** True when this turn advanced the workflow to the next step. */
  advanced: boolean;
  /** True when the workflow finished with this turn. */
  finished: boolean;
}

export interface ExecutorTurnContext {
  /** Request-scoped LangChain config (chat id, abort signal, selections). */
  config?: Record<string, unknown>;
  /** The tools the workflow agent may call, built for this request. */
  tools: StructuredToolLike[];
  /** Model name override from the chat composer, if any. */
  selectedModel?: string;
}

/**
 * Minimal structural type so the step-by-step module does not have to
 * import concrete LangChain classes everywhere.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface StructuredToolLike {
  name: string;
  description: string;
  invoke: (
    input?: any,
    config?: any,
  ) => Promise<any>;
}

export type { BaseMessage };

export function emptyMemory(): StepMemory {
  return {
    outcome: "",
    decisions: [],
    artifacts: [],
    openItems: [],
  };
}
