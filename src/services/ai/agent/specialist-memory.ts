import { dispatchMemorySaveActivity } from "../../../chat/services/memoryActivity";
import { databaseManager } from "../../../chat/project/memory/storage/databaseManager";
import type { Turn } from "../../../chat/project/memory/createTurn";
import { runProjectMemoryExclusive } from "../../../chat/project/memory/projectMemoryOperationQueue";
import { saveProjectMemory } from "../../../chat/project/memory/saveProjectMemory";

export interface SpecialistSectionMemoryInput {
  sessionType: "focus" | "step-by-step";
  sessionId: string;
  sectionNumber: number;
  goal: string;
  summary: string;
  decisions: string[];
  artifacts: string[];
  openItems: string[];
  projectPath?: string;
  chatId: string;
}

export interface SpecialistProjectMemoryMatch {
  tag: string;
  sessionType: "focus" | "step-by-step";
  sessionId: string;
  sectionNumber: number;
  goal: string;
  summary: string;
  decisions: string[];
  artifacts: string[];
  openItems: string[];
  createdAt: string;
}

/** Filter used to find tagged specialist handoffs in a project's memory. */
export interface SpecialistProjectMemoryQuery {
  /** Exact memory tag. When set, all other filters are still applied. */
  tag?: string;
  sessionType?: "focus" | "step-by-step";
  sessionId?: string;
  sectionNumber?: number;
  /** Maximum number of matches to return (newest first). */
  limit?: number;
}

export function createSpecialistMemoryTag(input: Pick<SpecialistSectionMemoryInput, "sessionType" | "sessionId" | "sectionNumber">): string {
  return `mocu:specialist:${input.sessionType}:${input.sessionId}:${input.sectionNumber}`;
}

/**
 * Serializes one value list as indented bullet lines. Bullets round-trip
 * losslessly even when an item itself contains "; " or line breaks.
 */
function bulletList(label: string, values: string[]): string[] {
  const items = values.map((value) => value.trim()).filter(Boolean);
  if (!items.length) return [];
  return [`${label}:`, ...items.map((item) => `  - ${item.replace(/\r?\n/g, " ")}`)];
}

const STOP_LABELS = [
  "Memory tag",
  "Session type",
  "Session ID",
  "Section/step number",
  "Goal",
  "Summary",
  "Decisions",
  "Artifacts",
  "Open items",
  "To inspect",
];

/**
 * Builds the exact text stored in project memory for one completed specialist
 * section. Exported so the memory format can be round-trip tested without a
 * database.
 */
export function buildSpecialistHandoffText(
  input: SpecialistSectionMemoryInput,
  tag = createSpecialistMemoryTag(input),
): { userMessage: string; agentResponse: string } {
  const tagLine = `Memory tag: ${tag}`;
  const userMessage = [
    "Completed specialist section handoff.",
    tagLine,
    `Session type: ${input.sessionType}`,
    `Session ID: ${input.sessionId}`,
    `Section/step number: ${input.sectionNumber}`,
    `Goal: ${input.goal}`,
  ].join("\n");

  const agentResponse = [
    "Persistent specialist-session handoff for the main project agent.",
    tagLine,
    `Session type: ${input.sessionType}`,
    `Session ID: ${input.sessionId}`,
    `Section/step number: ${input.sectionNumber}`,
    `Goal: ${input.goal}`,
    `Summary: ${input.summary}`,
    ...bulletList("Decisions", input.decisions),
    ...bulletList("Artifacts", input.artifacts),
    ...bulletList("Open items", input.openItems),
    `To inspect detailed conversation/tool records, use read_specialist_section_history with sessionType=${input.sessionType}, sessionId=${input.sessionId}, sectionNumber=${input.sectionNumber}.`,
  ].filter(Boolean).join("\n");

  return { userMessage, agentResponse };
}

/**
 * Saves one completed Focus section or workflow step to the selected project's
 * memory. Specialist handoffs are deliberately never written to app-wide memory.
 *
 * The stored text carries a stable `Memory tag` id so the project agent can
 * fetch this exact summary later with find_specialist_project_memory and only
 * then descend into the detailed section history.
 */
export function saveSpecialistSectionMemoryInBackground(
  input: SpecialistSectionMemoryInput,
): void {
  const projectPath = input.projectPath?.trim();
  if (!projectPath) {
    console.warn("[Project Memory] Skipping specialist handoff without an active project folder.");
    return;
  }

  const tag = createSpecialistMemoryTag(input);
  const { userMessage, agentResponse } = buildSpecialistHandoffText(input, tag);

  dispatchMemorySaveActivity({
    status: "saving",
    chatId: input.chatId,
    projectPath,
  });

  void saveProjectMemory({ userMessage, agentResponse, projectPath }).then((result) => {
    console.log("[Project Memory] Specialist section handoff saved:", {
      tag,
      turnId: result.processResult.turnId,
      databasePath: result.databasePath,
    });
    dispatchMemorySaveActivity({ status: "done", chatId: input.chatId, projectPath });
  }).catch((error: unknown) => {
    console.error("[Project Memory] Failed to save specialist section handoff:", error);
    dispatchMemorySaveActivity({ status: "error", chatId: input.chatId, projectPath });
  });
}

/**
 * Finds tagged specialist handoffs in the selected project's memory.
 *
 * Pass the exact tag for one summary, or any combination of sessionType,
 * sessionId, and sectionNumber to search. With no filter at all the most
 * recent handoffs are returned. Matches are newest first.
 */
export async function findSpecialistProjectMemories(
  projectPath: string,
  query: SpecialistProjectMemoryQuery = {},
): Promise<SpecialistProjectMemoryMatch[]> {
  const normalizedProjectPath = projectPath.trim();
  if (!normalizedProjectPath) return [];

  const normalizedTag = query.tag?.trim() || null;
  const normalizedSessionId = query.sessionId?.trim() || null;
  const limit = Math.max(1, Math.min(query.limit ?? 10, 50));

  return runProjectMemoryExclusive(async () => {
    await databaseManager.useProjectDatabase(normalizedProjectPath);
    const turns = await databaseManager.getByType<Turn>("turn");

    const matches: SpecialistProjectMemoryMatch[] = [];
    for (const record of turns) {
      const turn = record.data;
      const userText = typeof turn?.userMessage === "string" ? turn.userMessage : "";
      const responseText = typeof turn?.agentResponse === "string" ? turn.agentResponse : "";
      const match = parseSpecialistHandoff(userText, responseText, turn?.createdAt ?? new Date(record.createdAt).toISOString());
      if (!match) continue;

      if (normalizedTag && match.tag !== normalizedTag) continue;
      if (query.sessionType && match.sessionType !== query.sessionType) continue;
      if (normalizedSessionId && match.sessionId !== normalizedSessionId) continue;
      if (typeof query.sectionNumber === "number" && match.sectionNumber !== query.sectionNumber) continue;

      matches.push(match);
    }

    matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return matches.slice(0, limit);
  });
}

/** Finds one exact, tagged specialist handoff in the selected project's memory. */
export async function findSpecialistProjectMemoryByTag(
  projectPath: string,
  tag: string,
): Promise<SpecialistProjectMemoryMatch | null> {
  const normalizedTag = tag.trim();
  if (!normalizedTag) return null;
  const [match] = await findSpecialistProjectMemories(projectPath, {
    tag: normalizedTag,
    limit: 1,
  });
  return match ?? null;
}

/**
 * Parses one stored specialist handoff back into its structured form.
 * Exported so the memory format can be unit-tested without a database.
 * Returns null when the text is not a tagged specialist handoff.
 */
export function parseSpecialistHandoff(
  userText: string,
  responseText: string,
  createdAt: string,
): SpecialistProjectMemoryMatch | null {
  /*
   * All fields are written to the agent response; only fall back to the
   * user message for the tag so older/partial records still resolve.
   */
  const tag = firstMatch(responseText, /^Memory tag: (.+)$/m)
    ?? firstMatch(userText, /^Memory tag: (.+)$/m);
  if (!tag?.startsWith("mocu:specialist:")) return null;

  const sessionType = firstMatch(responseText, /^Session type: (focus|step-by-step)$/m)
    ?? firstMatch(userText, /^Session type: (focus|step-by-step)$/m);
  const sessionId = firstMatch(responseText, /^Session ID: (.+)$/m)
    ?? firstMatch(userText, /^Session ID: (.+)$/m);
  const sectionRaw = firstMatch(responseText, /^Section\/step number: (\d+)$/m)
    ?? firstMatch(userText, /^Section\/step number: (\d+)$/m);
  if (!sessionType || !sessionId || !sectionRaw) return null;

  return {
    tag: tag.trim(),
    sessionType: sessionType as "focus" | "step-by-step",
    sessionId: sessionId.trim(),
    sectionNumber: Number(sectionRaw),
    goal: extractBlock(responseText, "Goal").replace(/\s+/g, " ").trim(),
    summary: extractBlock(responseText, "Summary").trim(),
    decisions: extractList(responseText, "Decisions"),
    artifacts: extractList(responseText, "Artifacts"),
    openItems: extractList(responseText, "Open items"),
    createdAt,
  };
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1] ?? null;
}

/**
 * Extracts everything between `Label:` and the next known label line,
 * so multi-line values survive the round-trip.
 */
function extractBlock(text: string, label: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${label}:`));
  if (start < 0) return "";

  const first = lines[start].slice(label.length + 1).replace(/^ /, "");
  const body = [first];
  for (const line of lines.slice(start + 1)) {
    if (STOP_LABELS.some((stop) => line.startsWith(`${stop}:`))) break;
    body.push(line);
  }
  return body.join("\n");
}

/**
 * Parses one value list. Prefers the bullet format (lossless); falls back to
 * the legacy "a; b; c" single-line format for handoffs saved before bullets.
 */
function extractList(text: string, label: string): string[] {
  const block = extractBlock(text, label);
  if (!block.trim()) return [];

  const bulletItems = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  if (bulletItems.length) return bulletItems;

  return block
    .split(/\r?\n/)
    .join("; ")
    .split("; ")
    .map((item) => item.trim())
    .filter(Boolean);
}
