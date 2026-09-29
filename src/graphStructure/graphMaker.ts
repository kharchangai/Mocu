import type { GraphRecorder, GraphRecord } from "./recorder";

export type GraphNodeKind = "run" | "user_message" | "model_call" | "tool_call" | "final_answer";
export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  at: number;
  attributes: Record<string, unknown>;
};
export type GraphEdgeType = "START" | "NEXT" | "CALLS" | "PARENT";
export type GraphEdge = { from: string; to: string; type: GraphEdgeType };
export type AgentRunGraph = {
  runId: string;
  agentKind: string;
  chatId?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  projectPath?: string;
};

const mergeToolNodes = (records: readonly GraphRecord[]): Map<string, GraphNode> => {
  const nodes = new Map<string, GraphNode>();
  for (const record of records) {
    if (record.type !== "tool_call") continue;
    const existing = nodes.get(record.id);
    if (!existing) {
      nodes.set(record.id, {
        id: `tool:${record.id}`,
        kind: "tool_call",
        label: record.tool,
        at: record.at,
        attributes: {
          toolCallId: record.id,
          tool: record.tool,
          ...(record.args !== undefined ? { args: record.args } : {}),
          ...(record.result !== undefined ? { result: record.result } : {}),
          status: record.status,
        },
      });
      continue;
    }
    if (record.args !== undefined) existing.attributes.args = record.args;
    if (record.result !== undefined) existing.attributes.result = record.result;
    existing.attributes.status = record.status;
    existing.attributes.tool = record.tool;
    existing.label = record.tool;
  }
  return nodes;
};

export const buildGraph = (
  recorder: Pick<GraphRecorder, "runId" | "agentKind" | "chatId" | "getRecords"> & { projectPath?: string },
): AgentRunGraph => {
  const records = recorder.getRecords();
  const mergedTools = mergeToolNodes(records);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const runNode: GraphNode = {
    id: `run:${recorder.runId}`,
    kind: "run",
    label: recorder.runId,
    at: records.length ? records[0].at : 0,
    attributes: {
      agentKind: recorder.agentKind,
      ...(recorder.chatId !== undefined ? { chatId: recorder.chatId } : {}),
    },
  };
  nodes.push(runNode);

  let tail: GraphNode | undefined;
  let lastModel: GraphNode | undefined;
  const emittedTools = new Set<string>();
  const linkNext = (node: GraphNode): void => {
    edges.push({ from: tail ? tail.id : runNode.id, to: node.id, type: tail ? "NEXT" : "START" });
    tail = node;
  };
  const parentEdge = (node: GraphNode): void => {
    edges.push({ from: runNode.id, to: node.id, type: "PARENT" });
  };

  for (const record of records) {
    switch (record.type) {
      case "run_start": {
        const node: GraphNode = { id: "user_message", kind: "user_message", label: "User message", at: record.at, attributes: { text: record.userMessage } };
        linkNext(node); parentEdge(node); nodes.push(node); runNode.attributes.userMessage = record.userMessage;
        break;
      }
      case "model_call": {
        const node: GraphNode = {
          id: `model:${record.index}`,
          kind: "model_call",
          label: `Model call ${record.index + 1}`,
          at: record.at,
          attributes: {
            index: record.index,
            ...(record.thought !== undefined ? { thought: record.thought } : {}),
            ...(record.text !== undefined ? { text: record.text } : {}),
            hasToolCalls: record.hasToolCalls,
          },
        };
        linkNext(node); parentEdge(node); nodes.push(node); lastModel = node;
        break;
      }
      case "tool_call": {
        if (emittedTools.has(record.id)) break;
        emittedTools.add(record.id);
        const node = mergedTools.get(record.id) as GraphNode;
        linkNext(node); parentEdge(node); nodes.push(node);
        if (lastModel) edges.push({ from: lastModel.id, to: node.id, type: "CALLS" });
        break;
      }
      case "run_end": {
        const node: GraphNode = { id: "final_answer", kind: "final_answer", label: "Final answer", at: record.at, attributes: { text: record.finalAnswer } };
        linkNext(node); parentEdge(node); nodes.push(node); runNode.attributes.finalAnswer = record.finalAnswer;
        break;
      }
    }
  }

  return {
    runId: recorder.runId,
    agentKind: recorder.agentKind,
    ...(recorder.chatId !== undefined ? { chatId: recorder.chatId } : {}),
    ...(recorder.projectPath ? { projectPath: recorder.projectPath } : {}),
    nodes,
    edges,
  };
};
