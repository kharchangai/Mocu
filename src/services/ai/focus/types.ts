import type { BaseMessage } from "@langchain/core/messages";

export type FocusStatus = "active" | "completed" | "cancelled";

/** Compact carry-over context injected into every later section. */
export interface FocusMemory {
  summary: string;
  decisions: string[];
  artifacts: string[];
  openItems: string[];
}

export interface FocusState {
  id: string;
  chatId: string;
  createdAt: string;
  goal: string;
  projectPath?: string;
  selectedModel?: string;
  currentSectionNumber: number;
  status: FocusStatus;
  memories: Record<string, FocusMemory>;
}

export type FocusLogKind =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "summary"
  | "milestone"
  | "transition"
  | "error";

export interface FocusLogEntry {
  id: string;
  focusId: string;
  sectionNumber: number;
  time: string;
  kind: FocusLogKind;
  data: unknown;
}

/* Minimal structural type shared with the selected task tools. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FocusToolLike {
  name: string;
  description: string;
  invoke: (input?: any, config?: any) => Promise<any>;
}

export interface FocusTurnContext {
  config?: Record<string, unknown>;
  tools: FocusToolLike[];
  selectedModel?: string;
}

export interface FocusTurnResult {
  reply: string;
  status: FocusStatus;
  currentSectionNumber: number;
  advanced: boolean;
  finished: boolean;
}

export type { BaseMessage };

export function emptyFocusMemory(): FocusMemory {
  return { summary: "", decisions: [], artifacts: [], openItems: [] };
}
