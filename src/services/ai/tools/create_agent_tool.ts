import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { parseAgentDefinition } from "../../../chat/agent/agent-definition-parser";

/**
 * Create Agent Tool.
 *
 * Exposes the agent creator (parseAgentDefinition) to the main chat agent.
 * When the user asks to create a new agent, the model calls this tool with
 * the user's full request. The tool converts the description into a
 * structured agent definition and saves it under
 * AppData (com.mocu.app)/agents/<agentName>/<agentName>.json, which makes
 * it immediately discoverable by the agent loader.
 */
export const createAgentTool = tool(
  async ({ userRequest }) => {
    console.log(
      "[Create Agent Tool] Creating a new agent from user request.",
    );

    try {
      const definition =
        await parseAgentDefinition(
          userRequest,
        );

      console.log(
        `[Create Agent Tool] Agent "${definition.agentName}" created.`,
      );

      return [
        `Agent created successfully.`,
        "",
        `Name: ${definition.agentName}`,
        `Instruction: ${definition.mainInstruction}`,
        `Agents: ${definition.agents.length > 0 ? definition.agents.join(", ") : "none"}`,
        `Skills: ${definition.skills.length > 0 ? definition.skills.join(", ") : "none"}`,
        `Tools: ${definition.tools.length > 0 ? definition.tools.join(", ") : "none"}`,
        `Extensions: ${definition.extensions.length > 0 ? definition.extensions.join(", ") : "none"}`,
        `LLM: ${definition.llm ?? "default"}`,
        "",
        "The agent is saved and available for the user in the Agents page. The user can select it in a new message to run it as a specialist agent.",
      ].join("\n");
    } catch (error) {
      console.error(
        "[Create Agent Tool] Failed to create agent:",
        error,
      );

      return `Error: The agent could not be created. Details: ${error}`;
    }
  },
  {
    name: "create_agent",
    description:
      "Creates a new persistent agent from the user's description. " +
      "Call this tool whenever the user asks to create, build, or make a new agent. " +
      "Pass the user's complete request unchanged so the agent creator can extract " +
      "the agent name, instruction, agents, skills, tools, extensions, and LLM.",
    schema: z.object({
      userRequest: z
        .string()
        .min(1)
        .describe(
          "The user's complete agent-creation request, unchanged.",
        ),
    }),
  },
);
