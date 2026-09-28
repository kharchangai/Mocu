// src/graphStructure/recorder.ts
//
// Graph recorder shared by every Mocu agent (chat, project, focus,
// step-by-step).
//
// The recorder sits NEXT TO an agent and captures what happened during one
// run as a flat list of raw records:
//
//   run_start  -> the user message that began the run
//   model_call -> every LLM call (thought, text, whether it wanted tools)
//   tool_call  -> every tool execution (id, name, args, result, status)
//   run_end    -> the final answer shown to the user
//
// Recording must never break or slow down the agent: every method swallows
// its own errors and only warns. The records are later turned into a graph
// by buildGraph() in graphMaker.ts — this module deliberately does NOT
// interpret anything, it only records.

export type AgentKind = "chat" | "project" | "focus" | "stepbystep";

export type ToolCallStatus = "running" | "done" | "error" | "cancelled";

export type RunStartRecord = {
  type: "run_start";
  at: number;
  userMessage: string;
};

export type ModelCallRecord = {
  type: "model_call";
  at: number;
  /** 0-based order of the model call inside this run. */
  index: number;
  /** Reasoning streamed by the model, if captured. */
  thought?: string;
  /** Text the model produced, if captured. */
  text?: string;
  hasToolCalls: boolean;
};

export type ToolCallRecord = {
  type: "tool_call";
  at: number;
  /** LangChain tool_call_id — stable across running/done updates. */
  id: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  status: ToolCallStatus;
};

export type RunEndRecord = {
  type: "run_end";
  at: number;
  finalAnswer: string;
};

export type GraphRecord =
  | RunStartRecord
  | ModelCallRecord
  | ToolCallRecord
  | RunEndRecord;

export type GraphRecorderOptions = {
  agentKind: AgentKind;
  chatId?: string;
  /** Optional explicit id; generated when omitted. */
  runId?: string;
};

export type GraphRecorder = {
  readonly runId: string;
  readonly agentKind: AgentKind;
  readonly chatId?: string;
  /** Call once at the start of the run with the user's message. */
  startRun: (userMessage: string) => void;
  /** Call after each model invocation; returns the call index used. */
  recordModelCall: (call: {
    thought?: string;
    text?: string;
    hasToolCalls?: boolean;
  }) => number;
  /**
   * Call around each tool execution. Dispatch once with status "running"
   * before the tool runs, then again with the result and a terminal status.
   * Records sharing an id are merged by the graph maker.
   */
  recordToolCall: (call: {
    id: string;
    tool: string;
    args?: Record<string, unknown>;
    result?: string;
    status?: ToolCallStatus;
  }) => void;
  /** Call once at the end of the run with the final user-facing answer. */
  finishRun: (finalAnswer: string) => void;
  getRecords: () => readonly GraphRecord[];
};

let recorderCounter = 0;

const safeNow = (): number => Date.now();

export const createGraphRecorder = (
  options: GraphRecorderOptions,
): GraphRecorder => {
  const runId =
    options.runId ??
    `run-${safeNow().toString(36)}-${(recorderCounter += 1)}`;

  const records: GraphRecord[] = [];
  let modelCallCount = 0;
  let started = false;
  let finished = false;

  const push = (record: GraphRecord): void => {
    records.push(record);
  };

  return {
    runId,
    agentKind: options.agentKind,
    chatId: options.chatId,

    startRun(userMessage: string): void {
      try {
        if (started) {
          return;
        }
        started = true;
        push({
          type: "run_start",
          at: safeNow(),
          userMessage,
        });
      } catch (error) {
        console.warn("[GraphRecorder] startRun failed:", error);
      }
    },

    recordModelCall(call): number {
      try {
        const index = modelCallCount;
        modelCallCount += 1;
        push({
          type: "model_call",
          at: safeNow(),
          index,
          ...(call.thought !== undefined ? { thought: call.thought } : {}),
          ...(call.text !== undefined ? { text: call.text } : {}),
          hasToolCalls: call.hasToolCalls ?? false,
        });
        return index;
      } catch (error) {
        console.warn("[GraphRecorder] recordModelCall failed:", error);
        return -1;
      }
    },

    recordToolCall(call): void {
      try {
        push({
          type: "tool_call",
          at: safeNow(),
          id: call.id,
          tool: call.tool,
          ...(call.args !== undefined ? { args: call.args } : {}),
          ...(call.result !== undefined ? { result: call.result } : {}),
          status: call.status ?? "done",
        });
      } catch (error) {
        console.warn("[GraphRecorder] recordToolCall failed:", error);
      }
    },

    finishRun(finalAnswer: string): void {
      try {
        if (finished) {
          return;
        }
        finished = true;
        push({
          type: "run_end",
          at: safeNow(),
          finalAnswer,
        });
      } catch (error) {
        console.warn("[GraphRecorder] finishRun failed:", error);
      }
    },

    getRecords(): readonly GraphRecord[] {
      return records;
    },
  };
};