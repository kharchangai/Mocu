import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { loadSkillContentByName } from "../../../chat/components/skills/selected-skill-loader";

/**
 * Load Skill Tool.
 *
 * The system prompt only contains the name and description of the
 * selected skills. When the agent decides a skill is relevant, it calls
 * this tool with the skill's name to receive the full SKILL.md
 * instructions. This keeps the context window small while still giving
 * the agent on-demand access to complete skill content.
 */
export const skillLoaderTool = tool(
  async ({ skillName }) => {
    console.log(
      `[Skill Tool] Loading full content for skill: "${skillName}"`,
    );

    try {
      const content =
        await loadSkillContentByName(
          skillName,
        );

      if (content === null) {
        console.warn(
          `[Skill Tool] Skill not found: "${skillName}"`,
        );

        return `Error: No skill named "${skillName}" was found. Check the exact skill name from the SELECTED SKILLS list and try again.`;
      }

      return [
        `SKILL: ${skillName}`,
        "",
        content,
      ].join("\n");
    } catch (error) {
      console.error(
        "[Skill Tool] Failed to load skill:",
        error,
      );

      return `Error: The skill "${skillName}" could not be loaded. Details: ${error}`;
    }
  },
  {
    name: "load_skill",
    description:
      "Loads the full instructions of a selected skill by its exact name. " +
      "The system prompt lists selected skills with only their name and description; " +
      "call this tool before following any skill so you receive its complete instructions.",
    schema: z.object({
      skillName: z
        .string()
        .describe(
          "The exact name of the skill to load, as shown in the SELECTED SKILLS section.",
        ),
    }),
  },
);
