import type { StructuredToolInterface } from "@langchain/core/tools";

import { runProjectMemoryExclusive } from "../chat/project/memory/projectMemoryOperationQueue";
import { cleanRunRecords } from "./cleanup";
import { createGraphDigestTool, searchRunGraphHints } from "./graphDigest";
import { buildGraph } from "./graphMaker";
import { createGraphRecorder, type AgentKind, type GraphRecorder } from "./recorder";
import { saveRunGraph } from "./graphStorage";
import { shouldRouteToGraphSystem } from "./jevGate";

export interface PreparedAgentGraphTurn {
  projectPath: string;
  recorder: GraphRecorder | null;
  graphHint: string;
  digestTool: StructuredToolInterface | null;
}

/**
 * Prepares project-scoped prior-run retrieval and optional graph recording for
 * one specialist turn. Retrieval remains available even when JEV decides that
 * this turn should not be persisted, matching the project agent behavior.
 */
export async function prepareAgentGraphTurn(input: {
  agentKind: Extract<AgentKind, "focus" | "stepbystep">;
  chatId: string;
  projectPath?: string;
  userMessage: string;
}): Promise<PreparedAgentGraphTurn> {
  const projectPath = input.projectPath?.trim() ?? "";
  if (!projectPath) {
    return { projectPath: "", recorder: null, graphHint: "", digestTool: null };
  }

  let graphHint = "";
  try {
    graphHint = await searchRunGraphHints(projectPath, input.userMessage);
  } catch (error) {
    console.warn(`[${input.agentKind}] Prior run graph search failed; continuing without a hint:`, error);
  }

  let recorder: GraphRecorder | null = null;
  try {
    if (await shouldRouteToGraphSystem(input.userMessage)) {
      recorder = createGraphRecorder({
        agentKind: input.agentKind,
        chatId: input.chatId,
        projectPath,
      });
      recorder.startRun(input.userMessage);
    }
  } catch (error) {
    console.warn(`[${input.agentKind}] JEV graph-recording gate failed; continuing without recording:`, error);
  }

  let digestTool: StructuredToolInterface | null = null;
  try {
    digestTool = createGraphDigestTool(projectPath).runnable as StructuredToolInterface;
  } catch (error) {
    console.warn(`[${input.agentKind}] Could not create the prior-run digest tool:`, error);
  }

  return { projectPath, recorder, graphHint, digestTool };
}

/** Save one specialist turn's graph best-effort; this must never fail the task. */
export async function persistAgentGraphTurn(
  prepared: PreparedAgentGraphTurn,
  finalAnswer: string,
  logPrefix: string,
): Promise<void> {
  const recorder = prepared.recorder;
  if (!recorder || !prepared.projectPath) return;

  recorder.finishRun(finalAnswer);
  try {
    const cleanup = await cleanRunRecords(recorder.getRecords());
    const graph = buildGraph({
      runId: recorder.runId,
      agentKind: recorder.agentKind,
      chatId: recorder.chatId,
      projectPath: prepared.projectPath,
      getRecords: () => cleanup.kept,
    });
    const saved = await runProjectMemoryExclusive(() => saveRunGraph(prepared.projectPath, graph));
    console.log(`${logPrefix} Saved run graph ${saved.key}; embedded=${saved.embedded}`);
  } catch (error) {
    console.warn(`${logPrefix} Graph recording failed; user task already completed:`, error);
  }
}
