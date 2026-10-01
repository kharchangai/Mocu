import { dispatchAgentActivity } from "../../services/ai/agent/helpers";

import { getActiveRequestChatId } from "../../chat/services/activeChatSession";
import { isAbortError } from "../../services/ai/agent/abort";
import { dispatchAgentToolActivity } from "../../chat/services/toolActivity";
import { respondExtension } from "./extension-client";
import { scanInstalledExtensions } from "./extension-scanner";
import {
  listAgentsForExtension,
  runAgentForExtension,
} from "./extension-agent-service";

const agentRuns = new Map<string, AbortController>();
const getAgentRunKey = (extensionId: string, requestId: string | number): string =>
  `${extensionId}:${requestId}`;

export function cancelExtensionAgentRun(
  extensionId: string,
  requestId: string | number,
): void {
  agentRuns.get(getAgentRunKey(extensionId, requestId))?.abort();
}

async function getExtensionPermissions(extensionId: string): Promise<string[]> {
  const installed = await scanInstalledExtensions();
  const extension = installed.find((entry) => entry.manifest.id === extensionId);
  if (!extension) {
    throw new Error(`Extension "${extensionId}" is not installed.`);
  }
  return extension.manifest.permissions ?? [];
}

async function respondWithFailure(
  extensionId: string,
  requestId: string | number | null,
  error: unknown,
): Promise<void> {
  if (requestId === null) return;
  await respondExtension(extensionId, requestId, null, {
    code: -32603,
    message: error instanceof Error ? error.message : String(error),
    data: null,
  });
}

export async function handleAgentsList(
  extensionId: string,
  requestId: string | number | null,
): Promise<void> {
  try {
    const permissions = await getExtensionPermissions(extensionId);
    const agents = await listAgentsForExtension(permissions);
    if (requestId !== null) {
      await respondExtension(extensionId, requestId, agents, null);
    }
  } catch (error) {
    await respondWithFailure(extensionId, requestId, error);
  }
}

export async function handleAgentRun(
  extensionId: string,
  requestId: string | number | null,
  params: Record<string, unknown>,
): Promise<void> {
  if (requestId === null) return;

  const input = typeof params.input === "string" ? params.input : "";
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const chatId = getActiveRequestChatId() ?? undefined;
  const activityId = `extension-agent:${extensionId}:${requestId}`;
  const activityTool = `extension_${extensionId}_agent`;
  const activityArgs = { agentId, input };
  const runKey = getAgentRunKey(extensionId, requestId);
  const controller = new AbortController();
  agentRuns.set(runKey, controller);

  dispatchAgentActivity(activityTool);
  dispatchAgentToolActivity({
    id: activityId,
    tool: activityTool,
    args: activityArgs,
    status: "running",
    chatId,
  });

  try {
    if (!agentId || !input.trim()) {
      throw new Error("mocu.agents.run requires non-empty string agentId and input parameters.");
    }
    const permissions = await getExtensionPermissions(extensionId);
    const result = await runAgentForExtension(permissions, agentId, input, controller.signal);
    dispatchAgentToolActivity({
      id: activityId,
      tool: activityTool,
      args: { agentId: result.agentId, input },
      result: result.text,
      status: "done",
      chatId,
    });
    await respondExtension(extensionId, requestId, result, null);
  } catch (error) {
    const cancelled = isAbortError(error) || controller.signal.aborted;
    const message = cancelled
      ? "Agent run was cancelled."
      : error instanceof Error ? error.message : String(error);
    dispatchAgentToolActivity({
      id: activityId,
      tool: activityTool,
      args: activityArgs,
      result: message,
      status: cancelled ? "cancelled" : "error",
      chatId,
    });
    await respondWithFailure(extensionId, requestId, error);
  } finally {
    agentRuns.delete(runKey);
    dispatchAgentActivity(null);
  }
}
