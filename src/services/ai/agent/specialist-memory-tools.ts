import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  findSpecialistProjectMemories,
  type SpecialistProjectMemoryMatch,
} from "./specialist-memory";
import {
  getFocusHistoryEntry,
  getFocusSectionHistory,
} from "../focus/focusManager";
import {
  getStepWorkflowLogEntry,
  getStepWorkflowStepHistory,
} from "../stepbystep/workflowManager";

const SPECIALIST_HISTORY_ENTRY_CHARS = 2_500;

function serializeSpecialistMemoryMatch(match: SpecialistProjectMemoryMatch) {
  return {
    tag: match.tag,
    sessionType: match.sessionType,
    sessionId: match.sessionId,
    sectionNumber: match.sectionNumber,
    createdAt: match.createdAt,
    goal: match.goal,
    summary: match.summary,
    decisions: match.decisions,
    artifacts: match.artifacts,
    openItems: match.openItems,
  };
}

/** Tool: find tagged Focus / step-by-step section summaries in project memory. */
export function createFindSpecialistProjectMemoryTool(projectPath: string) {
  return tool(async ({ tag, sessionType, sessionId, sectionNumber }) => {
    try {
      const matches = await findSpecialistProjectMemories(projectPath, {
        tag,
        sessionType,
        sessionId,
        sectionNumber,
        limit: 10,
      });

      if (!matches.length) {
        return JSON.stringify({
          found: false,
          query: { tag: tag ?? null, sessionType: sessionType ?? null, sessionId: sessionId ?? null, sectionNumber: sectionNumber ?? null },
          message: "No matching tagged Focus or step-by-step section summary was found in this project's memory.",
        }, null, 2);
      }

      return JSON.stringify({
        found: true,
        matches: matches.map(serializeSpecialistMemoryMatch),
        hint: "Use the summary fields directly when sufficient. Call read_specialist_section_history only for exact conversation or tool details, with the returned sessionType, sessionId, and sectionNumber.",
      }, null, 2);
    } catch (error) {
      console.error("[Specialist Memory] Failed to search specialist memory:", error);
      return `Could not search specialist memory: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "find_specialist_project_memory",
    description: "Find tagged Focus or step-by-step section summaries in the active project's memory. Pass the exact memory tag when known, or search by sessionId and/or sectionNumber (and sessionType). Returns compact summaries plus the exact sessionType/sessionId/sectionNumber needed for read_specialist_section_history. Read detailed history only if a summary is insufficient.",
    schema: z.object({
      tag: z.string().trim().min(1).optional().describe("Exact specialist memory tag from a 'Memory tag: mocu:specialist:...' line."),
      sessionType: z.enum(["focus", "step-by-step"]).optional().describe("Restrict the search to one specialist session type."),
      sessionId: z.string().trim().min(1).optional().describe("Specialist session id when the tag is unknown."),
      sectionNumber: z.number().int().positive().optional().describe("Specific section/step number when the tag is unknown."),
    }),
  });
}

/**
 * Tool: read one specialist section's stored history.
 *
 * Shared by the project agent, Focus, and Step-by-Step so every agent can
 * recall tagged handoffs of any specialist session in the same chat.
 */
export function createReadSpecialistSectionHistoryTool(chatId: string) {
  return tool(async ({ sessionType, sessionId, sectionNumber, offset, limit, entryId, entryOffset, entryLength }) => {
    try {
      if (entryId) {
        const result = sessionType === "focus"
          ? await getFocusHistoryEntry(chatId, sessionId, sectionNumber, entryId, entryOffset, entryLength)
          : await getStepWorkflowLogEntry(chatId, entryId, entryOffset, entryLength, sessionId);
        return result.text ? JSON.stringify({ sessionId, sectionNumber, entryId, ...result }) : `No history entry ${entryId} was found in this chat.`;
      }
      const entries = sessionType === "focus"
        ? await getFocusSectionHistory(chatId, sessionId, sectionNumber)
        : await getStepWorkflowStepHistory(chatId, sessionId, sectionNumber);
      const page = entries.slice(offset, offset + limit);
      return JSON.stringify({
        sessionType, sessionId, sectionNumber,
        entries: page.map((entry) => {
          const serialized = JSON.stringify(entry.data ?? null) ?? "null";
          return { id: entry.id, time: entry.time, kind: entry.kind, preview: serialized.slice(0, SPECIALIST_HISTORY_ENTRY_CHARS), truncated: serialized.length > SPECIALIST_HISTORY_ENTRY_CHARS };
        }),
        nextOffset: offset + page.length < entries.length ? offset + page.length : null,
      }, null, 2);
    } catch (error) {
      console.error("[Specialist Memory] Failed to read specialist section history:", error);
      return `Could not read specialist history: ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "read_specialist_section_history",
    description: "After finding a project memory summary, use only when more detail is needed. Reads history for exactly the returned section, not the whole session.",
    schema: z.object({
      sessionType: z.enum(["focus", "step-by-step"]),
      sessionId: z.string().min(1),
      sectionNumber: z.number().int().positive(),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().positive().max(20).default(10),
      entryId: z.string().optional(),
      entryOffset: z.number().int().nonnegative().default(0),
      entryLength: z.number().int().positive().max(20000).default(6000),
    }),
  });
}