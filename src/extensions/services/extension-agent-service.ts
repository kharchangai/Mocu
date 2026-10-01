import { findAvailableAgent, listAvailableAgents } from "../../chat/agent/agent-loader";
import { runAgent } from "../../chat/agent/agent-runner";
import { getActiveRequestChatId } from "../../chat/services/activeChatSession";
import { CHAT_ID_CONFIG_KEY } from "../../chat/services/toolActivity";
import type { RunnableConfig } from "@langchain/core/runnables";

const MAX_AGENT_INPUT_LENGTH = 100_000;
const AGENT_PERMISSION = "agents.invoke";

export async function listAgentsForExtension(
  permissions: string[] = [],
): Promise<Array<{ id: string; name: string; description: string }>> {
  requireAgentPermission(permissions);
  const agents = await listAvailableAgents();
  return agents.map(({ id, agentName, description }) => ({
    id,
    name: agentName,
    description,
  }));
}

export async function runAgentForExtension(
  permissions: string[] = [],
  agentId: string,
  input: string,
  signal?: AbortSignal,
): Promise<{ agentId: string; name: string; text: string }> {
  requireAgentPermission(permissions);

  const normalizedId = agentId.trim();
  const normalizedInput = input.trim();
  if (!normalizedId) throw new Error("mocu.agents.run requires a non-empty agentId.");
  if (!normalizedInput) throw new Error("mocu.agents.run requires a non-empty input string.");
  if (normalizedInput.length > MAX_AGENT_INPUT_LENGTH) {
    throw new Error(`Agent input is too long (maximum ${MAX_AGENT_INPUT_LENGTH} characters).`);
  }

  const agent = await findAvailableAgent(normalizedId);
  if (!agent) throw new Error(`Agent "${normalizedId}" was not found in the current user's saved agents.`);

  const chatId = getActiveRequestChatId() ?? undefined;
  const config: RunnableConfig = {
    ...(chatId ? { configurable: { [CHAT_ID_CONFIG_KEY]: chatId } } : {}),
    ...(signal ? { signal } : {}),
  };

  const text = await runAgent({
    agent,
    userMessage: normalizedInput,
    // Extensions cannot choose an arbitrary filesystem/project path.
    projectPath: "",
    config,
  });

  return { agentId: agent.id, name: agent.agentName, text };
}

function requireAgentPermission(permissions: string[]): void {
  if (!permissions.includes(AGENT_PERMISSION)) {
    throw new Error(`This extension has not declared the "${AGENT_PERMISSION}" permission.`);
  }
}
