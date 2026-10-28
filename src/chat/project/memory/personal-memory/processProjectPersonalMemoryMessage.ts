import {
  classifyPersonalMemories,
  type PersonalMemoryClassification,
} from "./classifyPersonalMemories";
import {
  createProjectPersonalMemoryEntries,
  type ProjectPersonalMemoryEntry,
} from "./createPersonalMemoryEntries";
import {
  saveProjectPersonalMemoryEntries,
  type SaveProjectPersonalMemoryEntriesResult,
} from "./saveProjectPersonalMemoryEntries";

export type ProcessProjectPersonalMemoryMessageOptions = {
  signal?: AbortSignal;
  similarityThreshold?: number;
};

export type ProcessProjectPersonalMemoryMessageResult = {
  classification: PersonalMemoryClassification;
  entries: ProjectPersonalMemoryEntry[];
  saveResult: SaveProjectPersonalMemoryEntriesResult | null;
};

/**
 * Runs the complete project-personal-memory pipeline for one user message:
 * classify, prepare searchable entries, then persist/deduplicate them in the
 * SQLite database belonging to projectPath. If classification finds no
 * memories, no enrichment model, embeddings, or database are invoked.
 */
export async function processProjectPersonalMemoryMessage(
  userMessage: string,
  projectPath: string,
  options: ProcessProjectPersonalMemoryMessageOptions = {},
): Promise<ProcessProjectPersonalMemoryMessageResult> {
  if (typeof userMessage !== "string" || !userMessage.trim()) {
    throw new Error("userMessage must be a non-empty string.");
  }
  if (typeof projectPath !== "string" || !projectPath.trim()) {
    throw new Error("projectPath must be a non-empty project folder path.");
  }

  const classification = await classifyPersonalMemories(userMessage, {
    signal: options.signal,
  });

  if (!classification.containsPersonalMemory || classification.memories.length === 0) {
    return { classification, entries: [], saveResult: null };
  }

  const entries = await createProjectPersonalMemoryEntries(classification, {
    signal: options.signal,
  });

  // Be defensive if classification metadata and its memory list ever disagree.
  if (entries.length === 0) {
    return { classification, entries, saveResult: null };
  }

  const saveResult = await saveProjectPersonalMemoryEntries(projectPath, entries, {
    signal: options.signal,
    similarityThreshold: options.similarityThreshold,
  });

  return { classification, entries, saveResult };
}
