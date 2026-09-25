import { dispatchMemorySaveActivity } from "../../../chat/services/memoryActivity";
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

function list(label: string, values: string[]): string {
  const items = values.map((value) => value.trim()).filter(Boolean);
  return items.length ? `${label}: ${items.join("; ")}` : "";
}

/**
 * Saves one completed Focus section or workflow step into the same project
 * memory used by ordinary main-agent turns. This runs in the background so
 * writing the handoff never delays the user's specialist-agent response.
 */
export function saveSpecialistSectionMemoryInBackground(
  input: SpecialistSectionMemoryInput,
): void {
  const userMessage = [
    `Completed ${input.sessionType} section handoff.`,
    `Session ID: ${input.sessionId}`,
    `Section/step number: ${input.sectionNumber}`,
    `Goal: ${input.goal}`,
  ].join("\n");

  const agentResponse = [
    "Persistent specialist-session handoff for the main agent.",
    `Session type: ${input.sessionType}`,
    `Session ID: ${input.sessionId}`,
    `Section/step number: ${input.sectionNumber}`,
    `Goal: ${input.goal}`,
    `Summary: ${input.summary}`,
    list("Decisions", input.decisions),
    list("Artifacts", input.artifacts),
    list("Open items", input.openItems),
    `To inspect the detailed conversation/tool records, call read_specialist_section_history with sessionType=${input.sessionType}, sessionId=${input.sessionId}, sectionNumber=${input.sectionNumber}.`,
  ].filter(Boolean).join("\n");

  dispatchMemorySaveActivity({
    status: "saving",
    chatId: input.chatId,
    projectPath: input.projectPath,
  });

  void saveProjectMemory({
    userMessage,
    agentResponse,
    projectPath: input.projectPath,
  }).then((result) => {
    console.log("[Project Memory] Specialist section handoff saved:", {
      sessionType: input.sessionType,
      sessionId: input.sessionId,
      sectionNumber: input.sectionNumber,
      turnId: result.processResult.turnId,
      databasePath: result.databasePath,
    });
    dispatchMemorySaveActivity({
      status: "done",
      chatId: input.chatId,
      projectPath: input.projectPath,
    });
  }).catch((error: unknown) => {
    console.error("[Project Memory] Failed to save specialist section handoff:", error);
    dispatchMemorySaveActivity({
      status: "error",
      chatId: input.chatId,
      projectPath: input.projectPath,
    });
  });
}
