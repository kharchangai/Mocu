import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import { parseAgentDefinition } from "../../../chat/agent/agent-definition-parser";
import { selectAgentTools } from "../../../chat/agent/agent-tool-selector";

/**
 * Creates and saves a specialist-agent definition. Tool capabilities are
 * selected from the user's natural-language request by Jev before the LLM
 * generates the structured agent definition.
 */
export const createAgentTool = tool(
  async ({ userRequest }, config: RunnableConfig) => {
    console.log("[Create Agent Tool] Creating a new agent from user request.");

    try {
      const selectedTools = await selectAgentTools(userRequest, {
        signal: config?.signal,
      });
      const definition = await parseAgentDefinition(userRequest, {
        selectedTools: selectedTools.map((selection) => selection.name),
      });

      console.log(
        `[Create Agent Tool] Agent "${definition.agentName}" created.`,
      );

      return [
        "Agent created successfully.",
        "",
        `Name: ${definition.agentName}`,
        `Description: ${definition.description}`,
        `Instruction: ${definition.mainInstruction}`,
        `Agents: ${definition.agents.length > 0 ? definition.agents.join(", ") : "none"}`,
        `Skills: ${definition.skills.length > 0 ? definition.skills.join(", ") : "none"}`,
        `Tools: ${definition.tools.length > 0 ? definition.tools.join(", ") : "none"}`,
        `Tool matches: ${selectedTools.length > 0 ? selectedTools.map(({ name, relevance }) => `${name} (${Math.round(relevance * 100)}%)`).join(", ") : "none"}`,
        `Extensions: ${definition.extensions.length > 0 ? definition.extensions.join(", ") : "none"}`,
        `LLM: ${definition.llm ?? "default"}`,
        "",
        "The agent is saved and available for the user in the Agents page. The user can select it in a new message to run it as a specialist agent.",
      ].join("\n");
    } catch (error) {
      console.error("[Create Agent Tool] Failed to create agent:", error);
      return `Error: The agent could not be created. Details: ${error}`;
    }
  },
  {
    name: "create_agent",
    description:
      "Creates a new persistent agent from the user's description. " +
      "Call this tool whenever the user asks to create, build, or make a new agent. " +
      "Pass the user's complete request unchanged; the creator uses Jev plus explicit capability mentions to select exact supported tool names before generating the agent definition.",
    schema: z.object({
      userRequest: z
        .string()
        .min(1)
        .describe("The user's complete agent-creation request, unchanged."),
    }),
  },
);
