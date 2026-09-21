import { z } from "zod";
import { exists, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { getAsyncLLM } from "../../services/ai/llm";
import type { LlmTier } from "../../services/ai/llm";

export interface AgentDefinition {
  agentName: string;
  description: string;
  mainInstruction: string;
  agents: string[];
  skills: string[];
  tools: string[];
  extensions: string[];
  llm: string | null;
}

export interface ParseAgentDefinitionOptions {
  tier?: LlmTier;
}

const SYSTEM_PROMPT = `
Convert the user's agent description into a structured agent definition.

Rules:
- If the user explicitly provides an agent name, preserve and return that name in agentName.
- If the user does not provide an agent name, create a short and relevant name based on the requested task.
- Write a concise description of the agent in description: one or two sentences explaining what the agent does and when to use it. Do not copy the full task into description.
- Preserve the user's complete task in mainInstruction.
- Preserve the requested operation order, conditions, paths, constraints, and expected output.
- Extract only the agents explicitly requested by the user.
- Extract only the skills explicitly requested by the user.
- Extract only the tools explicitly requested by the user.
- Extract only the extensions explicitly requested by the user.
- Extract an LLM name only when the user explicitly requests a specific model.
- Preserve agent, skill, LLM, tool, and extension names as closely as possible to the user's wording.
- Generic references such as "an agent", "a sub-agent", "an LLM", "a language model", or "the model" are not specific names.
- Do not include the agent being created in the agents array.
- If no agent is explicitly requested, return an empty agents array.
- If no skill is explicitly requested, return an empty skills array.
- If no tool is explicitly requested, return an empty tools array.
- If no extension is explicitly requested, return an empty extensions array.
- If no specific LLM is explicitly requested, set llm to null.
- Never invent, recommend, replace, or automatically add agents, skills, tools, extensions, or an LLM.
- Do not translate explicitly provided names unless the user requests translation.
- Do not execute or answer the user's request.
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
        "The user's complete task, including its workflow, conditions, constraints, paths, and expected output.",
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
        "The tools explicitly requested by the user, or an empty array if none were requested.",
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

  const result = await structuredLlm.invoke([
    {
      role: "system",
      content: SYSTEM_PROMPT,
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
    tools: removeDuplicates(result.tools),
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