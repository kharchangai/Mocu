// src/graphStructure/graphTools.ts
//
// Agent-facing tools over the stored run graphs. They follow the same
// ToolDefinition shape used by ToolExecutor (see
// src/services/ai/agent/tool-executor.ts): name + description + execute.
//
// Registering these tools is deliberately NOT done here — step 6 wires
// them into the real chat/project pipelines. This file only builds the
// tool objects so they can be registered anywhere:
//
//   const executor = new ToolExecutor();
//   for (const tool of createGraphTools()) {
//     executor.registerTool(tool);
//   }

import type { ToolDefinition } from "../services/ai/agent/tool-executor";
import {
  DEFAULT_GRAPH_SEARCH_LIMIT,
  getRunGraphById,
  searchRunGraphs,
  type GraphSearchResult,
} from "./graphSearch";

type ToolArgs = Record<string, unknown>;

type ToolContext = Record<string, unknown> | undefined;

const getString = (args: ToolArgs, key: string): string => {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * projectPath precedence: explicit arg > tool context > empty (storage
 * then throws the same "no project is active" error as saveRunGraph).
 */
const resolveProjectPath = (
  args: ToolArgs,
  context: ToolContext,
): string => {
  const fromArg = getString(args, "projectPath");
  if (fromArg) {
    return fromArg;
  }
  const fromContext = context?.projectPath;
  return typeof fromContext === "string" ? fromContext.trim() : "";
};

const requireProjectPath = (
  args: ToolArgs,
  context: ToolContext,
  toolName: string,
): string => {
  const projectPath = resolveProjectPath(args, context);
  if (!projectPath) {
    throw new Error(
      `${toolName} requires an active project folder (projectPath).`,
    );
  }
  return projectPath;
};

const getOptionalLimit = (args: ToolArgs): number => {
  const raw = args.limit;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_GRAPH_SEARCH_LIMIT;
};

const serializeSearchResult = (result: GraphSearchResult): string => {
  const matches = result.matches.map((match) => ({
    runId: match.runId,
    agentKind: match.agentKind,
    ...(match.chatId !== undefined ? { chatId: match.chatId } : {}),
    savedAt: match.savedAt,
    score: Number(match.score.toFixed(6)),
    method: match.method,
    userMessage: match.searchable.userMessage,
    finalAnswer: match.searchable.finalAnswer,
    toolSummary: match.searchable.toolSummary,
    ...(match.graph
      ? {
          nodeCount: match.graph.nodes.length,
          edgeCount: match.graph.edges.length,
          nodes: match.graph.nodes,
          edges: match.graph.edges,
        }
      : {}),
  }));

  return JSON.stringify(
    {
      found: matches.length > 0,
      query: result.query,
      scoring: result.scoring,
      ...(result.vectorError ? { vectorError: result.vectorError } : {}),
      totalGraphs: result.totalGraphs,
      matches,
      hint:
        matches.length > 0
          ? "Use userMessage/finalAnswer/toolSummary as experience from earlier runs. Call get_run_graph with a runId when full nodes/edges are required."
          : "No relevant prior runs were found in this project.",
    },
    null,
    2,
  );
};

/**
 * Builds both graph tools. Same input → same tool objects; no state.
 */
export const createGraphTools = (): Array<
  ToolDefinition<Record<string, unknown>, string>
> => [
  {
    name: "search_run_graph",
    description:
      "Searches this project's saved agent-run graphs for prior experience relevant to the current question. Returns ranked matches with the earlier user message, final answer, and kept tool summaries (and full graph nodes/edges when includeGraph is true). Use before redoing exploration work that earlier runs may already solved.",
    execute: async (args: ToolArgs, context?: ToolContext) => {
      const projectPath = requireProjectPath(
        args,
        context,
        "search_run_graph",
      );
      const query = getString(args, "query");
      if (!query) {
        throw new Error(
          'search_run_graph requires a non-empty "query" argument.',
        );
      }

      try {
        const result = await searchRunGraphs(projectPath, query, {
          limit: getOptionalLimit(args),
          includeGraph: args.includeGraph === true,
        });
        return serializeSearchResult(result);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return JSON.stringify(
          {
            found: false,
            query,
            error: message,
            hint: "Graph search failed; continue the task without prior-run context.",
          },
          null,
          2,
        );
      }
    },
  },
  {
    name: "get_run_graph",
    description:
      "Loads one saved agent-run graph from the active project by runId (from search_run_graph or a prior save). Returns its searchable texts and full nodes/edges.",
    execute: async (args: ToolArgs, context?: ToolContext) => {
      const projectPath = requireProjectPath(
        args,
        context,
        "get_run_graph",
      );
      const runId = getString(args, "runId");
      if (!runId) {
        throw new Error(
          'get_run_graph requires a non-empty "runId" argument.',
        );
      }

      try {
        const data = await getRunGraphById(projectPath, runId);
        if (!data) {
          return JSON.stringify(
            {
              found: false,
              runId,
              hint: "No graph with this runId exists in the active project.",
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            found: true,
            runId,
            agentKind: data.agentKind,
            ...(data.chatId !== undefined ? { chatId: data.chatId } : {}),
            savedAt: data.savedAt,
            searchable: data.searchable,
            embedded: Array.isArray(data.embedding) && data.embedding.length > 0,
            embeddingModel: data.embeddingModel,
            graph: data.graph,
          },
          null,
          2,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return JSON.stringify(
          { found: false, runId, error: message },
          null,
          2,
        );
      }
    },
  },
];

/**
 * Registers both tools on an executor (helper for tests and step 6).
 */
export const registerGraphTools = (
  executor: {
    registerTool: (tool: ToolDefinition<Record<string, unknown>, string>) => void;
  },
): string[] => {
  const tools = createGraphTools();
  for (const tool of tools) {
    executor.registerTool(tool);
  }
  return tools.map((tool) => tool.name);
};
