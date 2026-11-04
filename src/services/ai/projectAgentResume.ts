import type { StoredMessage } from '@langchain/core/messages';

/** Serializable execution context needed to continue a cancelled Project Agent run. */
export type ProjectAgentResumeSnapshot = {
  version: 1;
  projectPath: string;
  originalUserPrompt: string;
  latestUserPrompt: string;
  modelId: string;
  gatewayBaseUrl: string;
  /** Exact model conversation, including the system prompt and completed tool exchanges. */
  messages: StoredMessage[];
  /** Exact tool schemas bound to the model for the cancelled run. */
  toolDefinitions: unknown[];
  configurable: {
    selectedSkills: string[];
    selectedExtensions: string[];
    selectedMcpServers: string[];
    selectedAgent: string | null;
    selectedModel: string;
    reasoningEffort: string | null;
    projectDescription: string;
  };
};

const snapshotsByChat = new Map<string, ProjectAgentResumeSnapshot>();

export function setProjectAgentRunSnapshot(
  chatId: string | undefined,
  snapshot: ProjectAgentResumeSnapshot,
): void {
  if (!chatId) return;
  // Keep only serializable data and prevent later mutations to live messages
  // from changing the checkpoint being prepared for the UI.
  try {
    snapshotsByChat.set(chatId, JSON.parse(JSON.stringify(snapshot)) as ProjectAgentResumeSnapshot);
  } catch (error) {
    console.warn('[Project Agent] Could not snapshot this run for exact resume:', error);
  }
}

export function getProjectAgentRunSnapshot(
  chatId: string | undefined,
): ProjectAgentResumeSnapshot | null {
  if (!chatId) return null;
  const snapshot = snapshotsByChat.get(chatId);
  if (!snapshot) return null;
  try {
    return JSON.parse(JSON.stringify(snapshot)) as ProjectAgentResumeSnapshot;
  } catch (error) {
    console.warn('[Project Agent] Could not read the resume snapshot:', error);
    return null;
  }
}

export function clearProjectAgentRunSnapshot(chatId: string | undefined): void {
  if (chatId) snapshotsByChat.delete(chatId);
}

export function isProjectAgentResumeSnapshot(
  value: unknown,
): value is ProjectAgentResumeSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ProjectAgentResumeSnapshot>;
  const configurable = candidate.configurable;
  return candidate.version === 1 &&
    typeof candidate.projectPath === 'string' &&
    typeof candidate.originalUserPrompt === 'string' &&
    typeof candidate.latestUserPrompt === 'string' &&
    typeof candidate.modelId === 'string' &&
    typeof candidate.gatewayBaseUrl === 'string' &&
    Array.isArray(candidate.messages) &&
    candidate.messages.length > 0 &&
    Array.isArray(candidate.toolDefinitions) &&
    Boolean(configurable) &&
    Array.isArray(configurable?.selectedSkills) &&
    Array.isArray(configurable?.selectedExtensions) &&
    Array.isArray(configurable?.selectedMcpServers) &&
    (typeof configurable?.selectedAgent === 'string' || configurable?.selectedAgent === null) &&
    typeof configurable?.selectedModel === 'string' &&
    (typeof configurable?.reasoningEffort === 'string' || configurable?.reasoningEffort === null) &&
    typeof configurable?.projectDescription === 'string';
}