import type { StructuredToolInterface } from "@langchain/core/tools";

import { runProjectMemoryExclusive } from "../chat/project/memory/projectMemoryOperationQueue";
import { cleanRunRecords } from "./cleanup";
import { createGraphToolLogTool, createGraphDigestTool, searchRunGraphHints } from "./graphDigest";
import { buildGraph } from "./graphMaker";
import { createGraphRecorder, type AgentKind, type GraphRecorder } from "./recorder";
import { saveRunGraph } from "./graphStorage";
import { shouldRouteToGraphSystem } from "./jevGate";

export interface PreparedAgentGraphTurn {
  projectPath: string;
  recorder: GraphRecorder | null;
  graphHint: string;
  digestTool: StructuredToolInterface | null;
  toolLogTool: StructuredToolInterface | null;
  persistRequested: boolean;
}

/** Prepare global prior-run retrieval and capture one specialist turn. */
export async function prepareAgentGraphTurn(input: {
  agentKind: Extract<AgentKind, "focus" | "stepbystep">;
  chatId: string;
  projectPath?: string;
  userMessage: string;
}): Promise<PreparedAgentGraphTurn> {
  const projectPath = input.projectPath?.trim() ?? "";
  const retrievalPath = projectPath || undefined;

  let graphHint = "";
  try {
    graphHint = await searchRunGraphHints(retrievalPath, input.userMessage);
  } catch (error) {
    console.warn(`[${input.agentKind}] Prior run graph search failed; continuing without a hint:`, error);
  }

  let persistRequested = false;
  try {
    persistRequested = await shouldRouteToGraphSystem(input.userMessage);
  } catch (error) {
    // A failed classifier must not suppress potentially useful history.
    console.warn(`[${input.agentKind}] JEV graph-recording gate failed; recording this turn:`, error);
    persistRequested = true;
  }

  // Capture calls even when JEV's initial message-only gate says no; an actual
  // tool-using turn can still be useful to remember and is evaluated at save time.
  const recorder = createGraphRecorder({ agentKind: input.agentKind, chatId: input.chatId, projectPath: retrievalPath });
  recorder.startRun(input.userMessage);

  let digestTool: StructuredToolInterface | null = null;
  let toolLogTool: StructuredToolInterface | null = null;
  try {
    digestTool = createGraphDigestTool(retrievalPath).runnable as StructuredToolInterface;
    toolLogTool = createGraphToolLogTool(retrievalPath).runnable as StructuredToolInterface;
  } catch (error) {
    console.warn(`[${input.agentKind}] Could not create prior-run graph tools:`, error);
  }
  return { projectPath, recorder, graphHint, digestTool, toolLogTool, persistRequested };
}

/** Save one useful specialist turn best-effort; never fail the user task. */
export async function persistAgentGraphTurn(
  prepared: PreparedAgentGraphTurn,
  finalAnswer: string,
  logPrefix: string,
): Promise<void> {
  const recorder = prepared.recorder;
  if (!recorder) return;
  recorder.finishRun(finalAnswer);
  const records = recorder.getRecords();
  const hasToolCalls = records.some((record) => record.type === "tool_call");
  if (!prepared.persistRequested && !hasToolCalls) return;

  try {
    const cleanup = await cleanRunRecords(records);
    const graph = buildGraph({
      runId: recorder.runId,
      agentKind: recorder.agentKind,
      chatId: recorder.chatId,
      projectPath: prepared.projectPath || undefined,
      getRecords: () => cleanup.kept,
    });
    const saved = await runProjectMemoryExclusive(() => saveRunGraph(prepared.projectPath || undefined, graph));
    console.log(`${logPrefix} Saved run graph ${saved.key}; embedded=${saved.embedded}`);
  } catch (error) {
    console.warn(`${logPrefix} Graph recording failed; user task already completed:`, error);
  }
}
