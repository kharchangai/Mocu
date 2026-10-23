import { beforeEach, describe, expect, it, vi } from "vitest";

const { listAvailableSkills, getJevDecision } = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  getJevDecision: vi.fn(),
}));

vi.mock("../../../chat/services/skillService", () => ({ listAvailableSkills }));
vi.mock("./decision/Jev_model", () => ({ getJevDecision }));

import { findRelevantSkillsTool } from "./find-relevant-skills-tool";

describe("find-relevant-skills-tool", () => {
  beforeEach(() => {
    listAvailableSkills.mockReset();
    getJevDecision.mockReset();
  });

  it("asks Jev to match the request against available skill names and descriptions", async () => {
    listAvailableSkills.mockResolvedValue([
      { name: "code-review", description: "Review code for bugs.", id: "1", source: "global", path: "" },
      { name: "recipe-writer", description: "Write recipes.", id: "2", source: "global", path: "" },
    ]);
    getJevDecision.mockResolvedValue({ answers: {
      skill_0: { noul: 0.92 },
      skill_1: { noul: 0.1 },
    } });

    const result = await findRelevantSkillsTool.invoke({ userRequest: "Review this code for bugs." });

    expect(getJevDecision).toHaveBeenCalledWith(expect.objectContaining({
      state: {
        user_request: "Review this code for bugs.",
        available_skills: [
          { name: "code-review", description: "Review code for bugs." },
          { name: "recipe-writer", description: "Write recipes." },
        ],
      },
      questions: expect.objectContaining({ skill_0: expect.objectContaining({ type: "noul" }) }),
    }));
    expect(JSON.parse(String(result))).toEqual([
      { name: "code-review", description: "Review code for bugs." },
    ]);
  });
});
