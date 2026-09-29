import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getJevDecision } from "../services/ai/tools/decision/Jev_model";
import { databaseManager } from "../chat/project/memory/storage/databaseManager";
import { runProjectMemoryExclusive } from "../chat/project/memory/projectMemoryOperationQueue";
import { getRunGraphById, searchRunGraphs } from "./graphSearch";
import { buildCompactDigest, compareProjectFileSnapshot, getGraphFilePaths, summarizeToolNode } from "./fileSnapshot";
import type { GraphNode } from "./graphMaker";

const MAX_RUNS_TO_CHECK = 3;
const MAX_TOOL_NODES_PER_RUN = 20;
const KEEP_THRESHOLD = 0.5;
const FAIL_OPEN_MAX_ITEMS = 4;

const probabilityFrom = (result: unknown, key: string): number => {
  if (!result || typeof result !== "object" || !("answers" in result)) throw new Error("Invalid JEV response.");
  const answers = (result as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object" || !(key in answers)) throw new Error(`JEV response missing ${key}.`);
  const answer = (answers as Record<string, unknown>)[key];
  if (!answer || typeof answer !== "object" || !("noul" in answer)) throw new Error(`JEV response missing ${key} probability.`);
  const value = (answer as { noul?: unknown }).noul;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid JEV probability for ${key}.`);
  return value;
};

const isRelevant = async (question: string, userMessage: string, node: GraphNode): Promise<boolean> => {
  const result = await getJevDecision({
    state: { currentQuestion: question, priorUserMessage: userMessage, priorTool: summarizeToolNode(node) },
    questions: {
      relevantNow: {
        type: "noul",
        instructions: "Would this prior tool result materially help answer or execute the user's current request, or prevent repeating relevant project exploration?",
        criteria: {
          true: "The prior result is relevant to the current request and worth including as compact historical context.",
          false: "The prior result is unrelated, redundant, or not useful for the current request.",
        },
      },
    },
  });
  return probabilityFrom(result, "relevantNow") >= KEEP_THRESHOLD;
};

/** Always-on lightweight project-scoped search; only a tiny hint is returned. */
export const searchRunGraphHints = async (projectPath: string, query: string): Promise<string> => {
  try {
    const result = await runProjectMemoryExclusive(async () => {
      await databaseManager.useProjectDatabase(projectPath);
      return searchRunGraphs(projectPath, query, { limit: 2 });
    });
    if (!result.matches.length) return "";
    const matches = result.matches.map((match) => ({
      runId: match.runId,
      priorTask: match.searchable.userMessage.slice(0, 160),
      score: Number(match.score.toFixed(3)),
    }));
    return `Prior project runs may be relevant: ${JSON.stringify(matches)}. Historical results are not in context yet. If useful, call get_relevant_run_graph_digest with the current question and a matching runId; it returns a JEV-filtered, freshness-checked compact digest.`;
  } catch (error) {
    console.warn("[Graph Digest] Automatic search failed; continuing without prior-run hint:", error);
    return "";
  }
};

export const buildRunGraphDigest = async (
  projectPath: string,
  currentQuestion: string,
  requestedRunId?: string,
): Promise<string> => {
  const query = currentQuestion.trim();
  if (!projectPath.trim() || !query) return JSON.stringify({ found: false, reason: "Project path or question is empty." });

  let candidates: Array<{ runId: string; score: number; data: Awaited<ReturnType<typeof getRunGraphById>> }> = [];
  if (requestedRunId?.trim()) {
    const data = await runProjectMemoryExclusive(async () => {
      await databaseManager.useProjectDatabase(projectPath);
      return getRunGraphById(projectPath, requestedRunId.trim());
    });
    if (data) candidates = [{ runId: requestedRunId.trim(), score: 1, data }];
  } else {
    const search = await runProjectMemoryExclusive(async () => {
      await databaseManager.useProjectDatabase(projectPath);
      return searchRunGraphs(projectPath, query, { limit: MAX_RUNS_TO_CHECK });
    });
    candidates = await runProjectMemoryExclusive(async () => {
      await databaseManager.useProjectDatabase(projectPath);
      return Promise.all(search.matches.map(async (match) => ({
        runId: match.runId,
        score: match.score,
        data: await getRunGraphById(projectPath, match.runId),
      })));
    });
  }

  for (const candidate of candidates) {
    const data = candidate.data;
    if (!data) continue;
    const toolNodes = data.graph.nodes.filter((node) => node.kind === "tool_call").slice(0, MAX_TOOL_NODES_PER_RUN);
    const selected: GraphNode[] = [];
    let jevFailed = false;

    for (const node of toolNodes) {
      try {
        if (await isRelevant(query, data.searchable.userMessage, node)) selected.push(node);
      } catch (error) {
        console.warn("[Graph Digest] JEV selection failed; using a small fail-open subset:", error);
        jevFailed = true;
        break;
      }
    }
    if (jevFailed && selected.length === 0) selected.push(...toolNodes.slice(0, FAIL_OPEN_MAX_ITEMS));
    if (selected.length === 0 && !jevFailed) continue;

    const freshness = await runProjectMemoryExclusive(async () => {
      await databaseManager.useProjectDatabase(projectPath);
      return compareProjectFileSnapshot(projectPath, data.fileSnapshot);
    });
    const root = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const digest = buildCompactDigest({
      runId: candidate.runId,
      savedAt: data.savedAt,
      userMessage: data.searchable.userMessage,
      finalAnswer: data.searchable.finalAnswer,
      items: selected.map((node) => {
        const nodePaths = getGraphFilePaths({ nodes: [node] }, projectPath).map((absolutePath) => {
          const relative = absolutePath.replace(/\\/g, "/").slice(root.length).replace(/^\//, "");
          return { path: relative, freshness: freshness[relative] ?? "unknown" };
        });
        return { summary: summarizeToolNode(node), paths: nodePaths };
      }),
    });
    return JSON.stringify({ found: true, score: candidate.score, jevFailOpen: jevFailed, digest: JSON.parse(digest) }, null, 2);
  }

  return JSON.stringify({ found: false, query, hint: "No relevant prior run details passed relevance selection. Continue with current project state." }, null, 2);
};
export const createGraphDigestTool = (projectPath: string) => {
  const execute = async (args: { query: string; runId?: string }): Promise<string> => {
    try {
      return await buildRunGraphDigest(projectPath, args.query, args.runId);
    } catch (error) {
      console.warn("[Graph Digest] Retrieval failed; continue without old context:", error);
      return JSON.stringify({ found: false, error: error instanceof Error ? error.message : String(error), hint: "Continue using current project files; no historical context was injected." });
    }
  };

  const runnable = tool(
    async ({ query, runId }) => execute({ query, runId }),
    {
      name: "get_relevant_run_graph_digest",
      description: "Retrieves a compact, JEV-filtered summary of relevant earlier work in this project. Uses read-only SHA-256 file snapshots and never invokes or modifies Git. Use before repeating substantial project exploration.",
      schema: z.object({
        query: z.string().min(1).describe("The current user request to select relevant prior run details."),
        runId: z.string().optional().describe("Optional run id from an earlier graph-search result."),
      }),
    },
  );

  return { name: runnable.name, description: runnable.description, runnable, execute };
};