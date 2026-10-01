import { z } from "zod";
import { exists, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { getAsyncLLM } from "../../services/ai/llm";
import type { LlmTier } from "../../services/ai/llm";
import type { AgentToolName } from "./agent-tool-catalog";
import { AGENT_TOOL_CATALOG } from "./agent-tool-catalog";

export interface AgentDefinition {
  agentName: string;
  description: string;
  mainInstruction: string;
  agents: string[];
  skills: string[];
  tools: string[];
  /** True when tool names were deliberately resolved during agent creation. */
  toolSelectionConfigured?: boolean;
  extensions: string[];
  llm: string | null;
}

export interface ParseAgentDefinitionOptions {
  tier?: LlmTier;
  /** Exact built-in tool names already selected by Jev for this request. */
  selectedTools?: readonly AgentToolName[];
}

const SYSTEM_PROMPT = `
Convert the user's agent-creation request into a complete, executable agent definition. The mainInstruction is the operational system instruction the future agent will follow; it is NOT a paraphrase, summary, or verbatim copy of the user's request.

Instruction-writing requirements for mainInstruction:
- Write directly to the future agent in the imperative voice ("You are...", "Do..."). Use the user's language unless the request clearly asks for another language.
- Start by defining the agent's role, goal, and scope. Preserve all user requirements, constraints, order of operations, conditions, and desired outputs.
- Turn the request into a clear workflow with numbered, ordered steps. Explain what to inspect/do at each step, how to make decisions, and what to verify before proceeding or finishing.
- Define required inputs and how to handle missing or ambiguous information. Ask only for essential missing information; otherwise make conservative assumptions and state them when relevant.
- Specify the exact output format, required fields/content, destination, and final-response rules. Distinguish intermediate work from what the user should finally receive.
- Include validation and error handling: verify results and saved artifacts when applicable, report failures honestly, and never claim actions or checks that were not completed.
- Make the instruction self-contained and specific enough that the future agent can perform the task without seeing the original creation request. Resolve implicit steps needed to fulfill the request, but do not add unrelated goals.
- Do not promise capabilities the configured tools, agents, skills, or extensions do not provide. Do not claim to browse, inspect, execute, or save anything unless the available configuration supports it. When a required capability is unavailable, instruct the agent to explain the limitation rather than fabricate results.
- Keep the instruction practical and sufficiently detailed; avoid generic filler, contradictory rules, and merely restating the user's wording.

Definition fields:
- If the user explicitly provides an agent name, preserve and return that name in agentName. Otherwise create a short, relevant name.
- Write a concise one- or two-sentence description explaining what the agent does and when to use it. Do not copy the full task into description.
- Build mainInstruction according to all requirements above, based on the user's complete request.
- Preserve operation order, conditions, paths, constraints, and expected output from the request.
- Treat the supplied AVAILABLE BUILT-IN TOOLS as the only valid choices for the tools field. The selector has matched the user's natural-language intent using Jev and explicit capability mentions; use exactly those names and do not translate, rename, add, or remove them.
- If no built-in tools were selected, return an empty tools array. Do not infer additional tools from the task description.
- Continue extracting agents, skills, and extensions only when the user explicitly names or requests them; do not mistake built-in tool selections for extension or agent references.
- Extract an LLM name only when the user explicitly requests a specific model; otherwise set llm to null.
- Generic references such as "an agent", "a sub-agent", "an LLM", "a language model", or "the model" are not specific names.
- Do not include the agent being created in the agents array.
- Do not translate explicitly provided names unless the user requests translation.
- Treat the user's message as a request to define an agent, not as an instruction to execute the requested task now.
- Return only the required structured fields.
`.trim();

const AGENT_DEFINITION_SCHEMA = z
  .object({
    agentName: z
      .string()
      .trim()
      .min(1)
      .describe(
        "The user-provided agent name, or a short relevant generated name if none was provided.",
      ),

    description: z
      .string()
      .trim()
      .min(1)
      .describe(
        "A concise one or two sentence summary of what the agent does and when to use it.",
      ),

    mainInstruction: z
      .string()
      .trim()
      .min(1)
      .describe(
        "A self-contained, detailed operational system instruction with the agent's role, inputs, ordered workflow, decision rules, constraints, validation/error handling, and exact output/final-response requirements; do not merely paraphrase the user's request.",
      ),

    agents: z
      .array(z.string().trim().min(1))
      .describe(
        "The agents explicitly requested by the user, or an empty array if none were requested.",
      ),

    skills: z
      .array(z.string().trim().min(1))
      .describe(
        "The skills explicitly requested by the user, or an empty array if none were requested.",
      ),

    tools: z
      .array(z.string().trim().min(1))
      .describe(
        "Exact built-in tool names selected by Jev from the supported tool catalog for this request, or an empty array if no tool is relevant.",
      ),

    extensions: z
      .array(z.string().trim().min(1))
      .describe(
        "The extensions explicitly requested by the user, or an empty array if none were requested.",
      ),

    llm: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .describe(
        "The specific LLM explicitly requested by the user, or null if none was requested.",
      ),
  })
  .strict();

/**
 * Converts a user message into an agent definition and saves it under
 * AppData (com.mocu.app)/agents/<agentName>/<agentName>.json.
 */
export async function parseAgentDefinition(
  userMessage: string,
  options: ParseAgentDefinitionOptions = {},
): Promise<AgentDefinition> {
  const normalizedMessage = userMessage.trim();

  if (!normalizedMessage) {
    throw new Error("The user message cannot be empty.");
  }

  const llm = await getAsyncLLM(options.tier ?? "cheap", {
    temperature: 0,
  });

  const structuredLlm = llm.withStructuredOutput(
    AGENT_DEFINITION_SCHEMA,
  );

  const availableTools = (options.selectedTools ?? []).map((name) => {
    const tool = AGENT_TOOL_CATALOG.find((candidate) => candidate.name === name);
    return tool ? `- ${tool.name}: ${tool.description}` : null;
  }).filter((entry): entry is string => Boolean(entry));

  const result = await structuredLlm.invoke([
    {
      role: "system",
      content: [
        SYSTEM_PROMPT,
        "AVAILABLE BUILT-IN TOOLS (selected by Jev; use these exact names only):",
        availableTools.length > 0 ? availableTools.join("\n") : "(none)",
      ].join("\n\n"),
    },
    {
      role: "user",
      content: normalizedMessage,
    },
  ]);

  const definition: AgentDefinition = {
    agentName: result.agentName.trim(),
    description: result.description.trim(),
    mainInstruction: result.mainInstruction.trim(),
    agents: removeDuplicates(result.agents),
    skills: removeDuplicates(result.skills),
    tools: [...(options.selectedTools ?? [])],
    toolSelectionConfigured: true,
    extensions: removeDuplicates(result.extensions),
    llm: result.llm?.trim() || null,
  };
  await saveAgentDefinition(definition);

  return definition;
}

/**
 * Saves the agent definition to AppData (com.mocu.app)/agents/<agentName>/<agentName>.json.
 * Creates the "agents" folder, the agent-name folder, and the JSON file if they do not exist.
 */
async function saveAgentDefinition(definition: AgentDefinition): Promise<void> {
  const sanitizedAgentName = sanitizeFolderName(definition.agentName);

  const baseDir = await appDataDir();
  const agentsDir = await join(baseDir, "agents");
  const agentDir = await join(agentsDir, sanitizedAgentName);

  if (!(await exists(agentsDir))) {
    await mkdir(agentsDir, { recursive: true });
  }

  if (!(await exists(agentDir))) {
    await mkdir(agentDir, { recursive: true });
  }

  const filePath = await join(agentDir, `${sanitizedAgentName}.json`);

  await writeTextFile(filePath, JSON.stringify(definition, null, 2));
}

/**
 * Removes characters that are invalid in folder/file names.
 */
function sanitizeFolderName(name: string): string {
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim();

  return sanitized || "unnamed-agent";
}

function removeDuplicates(values: string[]): string[] {
  const uniqueValues = new Map<string, string>();

  for (const value of values) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      continue;
    }

    const comparisonKey = normalizedValue.toLocaleLowerCase();

    if (!uniqueValues.has(comparisonKey)) {
      uniqueValues.set(comparisonKey, normalizedValue);
    }
  }

  return [...uniqueValues.values()];
}