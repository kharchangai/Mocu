import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import type { AvailableSkill } from "../../../chat/components/skillTypes";
import { listAvailableSkills } from "../../../chat/services/skillService";
import { getJevDecision } from "./decision/Jev_model";

/** Keep each Decisions API request small while allowing the catalog to scale. */
export const MAX_SKILLS_PER_DECISION = 32;
export const DEFAULT_SKILL_RELEVANCE_THRESHOLD = 0.6;

type JevAnswer = {
  noul?: unknown;
  probabilities?: Record<string, unknown>;
  value?: unknown;
  answer?: unknown;
};

type JevResponse = {
  answers?: Record<string, JevAnswer>;
};

function getRelevance(answer: JevAnswer | undefined): number {
  if (!answer || typeof answer !== "object") return 0;
  const noul = Number(answer.noul);
  if (Number.isFinite(noul)) return Math.max(0, Math.min(1, noul));

  if (answer.probabilities && typeof answer.probabilities === "object") {
    for (const key of ["true", "yes", "relevant", "related"]) {
      const value = Number(answer.probabilities[key]);
      if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
    }
  }

  const value = answer.value ?? answer.answer;
  return typeof value === "boolean" ? (value ? 1 : 0) : 0;
}

async function selectRelevantSkills(
  userRequest: string,
  skills: AvailableSkill[],
  signal?: AbortSignal,
): Promise<AvailableSkill[]> {
  const matches: AvailableSkill[] = [];

  for (let offset = 0; offset < skills.length; offset += MAX_SKILLS_PER_DECISION) {
    if (signal?.aborted) throw signal.reason;
    const batch = skills.slice(offset, offset + MAX_SKILLS_PER_DECISION);
    const questions = Object.fromEntries(batch.map((_, index) => [
      `skill_${index}`,
      {
        type: "noul" as const,
        instructions:
          "Decide whether this skill is genuinely useful for fulfilling the user's request. Judge its name and description by meaning, not superficial word overlap. Select it only when its instructions would materially help.",
        criteria: {
          true: "This skill is materially relevant and would help fulfill the request.",
          false: "This skill is not materially relevant to the request.",
        },
      },
    ]));

    const response = await getJevDecision({
      state: {
        user_request: userRequest,
        available_skills: batch.map(({ name, description }) => ({ name, description })),
      },
      questions,
      signal,
    }) as JevResponse;

    batch.forEach((skill, index) => {
      if (getRelevance(response?.answers?.[`skill_${index}`]) >= DEFAULT_SKILL_RELEVANCE_THRESHOLD) {
        matches.push(skill);
      }
    });
  }

  return matches;
}

/** Return only skill names and descriptions that Jev judged relevant to the request. */
export const findRelevantSkillsTool = tool(
  async ({ userRequest }, config: RunnableConfig) => {
    const request = userRequest.trim();
    if (!request) throw new Error("A non-empty user request is required.");

    const skills = await listAvailableSkills();
    if (skills.length === 0) return "[]";

    const matches = await selectRelevantSkills(request, skills, config?.signal);
    return JSON.stringify(matches.map(({ name, description }) => ({ name, description })), null, 2);
  },
  {
    name: "find_relevant_skills",
    description:
      "Find installed skills relevant to a user's request. Sends the request and available skill names/descriptions to Mocu's Decision model, then returns matching skill names and descriptions. Use this when choosing suitable skills for a task; it does not load their full instructions.",
    schema: z.object({
      userRequest: z.string().trim().min(1).describe("The complete request to match against available skill names and descriptions."),
    }),
  },
);

export default findRelevantSkillsTool;
