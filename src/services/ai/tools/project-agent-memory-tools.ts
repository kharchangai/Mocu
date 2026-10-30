import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  deleteProjectAgentMemory,
  listProjectAgentMemories,
  readProjectAgentMemory,
  saveProjectAgentMemory,
  updateProjectAgentMemory,
} from "../../../chat/project/memory/agent-memory/projectAgentMemory";

const tagSchema = z.array(z.string().trim().min(1).max(40)).min(1).max(12);
const contentSchema = z.string().trim().min(1).max(20_000);

/** Creates project-bound memory CRUD tools; unlike notes/docs, these files live only in this project. */
export function createProjectAgentMemoryTools(projectPath: string) {
  const save = tool(async ({ content, tags, title }) => {
    try {
      const memory = await saveProjectAgentMemory(projectPath, { content, tags, title });
      return `Project-agent memory saved.\nID: ${memory.id}\nTitle: ${memory.title}\nTags: ${memory.tags.join(", ")}`;
    } catch (error) {
      return `Error: The project-agent memory could not be saved. ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "save_project_agent_memory",
    description: "Saves a user-requested project-specific instruction, behavior preference, workflow, or fact for the project agent in this project's .mocu/agent-memory folder. Use when the user explicitly asks the agent to remember something for this project. Provide at least one meaningful tag. Include the reserved tag 'global' only when the memory must always be added to the prompt for every request in this project; otherwise use topical tags so Decision can select it only when relevant. Store concise, faithful guidance, not a task log.",
    schema: z.object({
      content: contentSchema.describe("The concise project-specific behavior, instruction, workflow, or fact to remember."),
      tags: tagSchema.describe("One or more topical tags. Add the exact tag 'global' only for instructions that must always apply across every request in this project."),
      title: z.string().trim().min(1).max(120).optional().describe("Optional short title; defaults to the first line of content."),
    }),
  });

  const read = tool(async ({ id }) => {
    try {
      const memory = await readProjectAgentMemory(projectPath, id);
      if (!memory) return `No project-agent memory with id "${id}" exists. Call list_project_agent_memories to see saved IDs.`;
      return JSON.stringify(memory, null, 2);
    } catch (error) {
      return `Error: The project-agent memory could not be read. ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "read_project_agent_memory",
    description: "Reads one complete project-agent memory from this project's .mocu/agent-memory folder by its exact ID.",
    schema: z.object({ id: z.string().trim().min(1).describe("Exact memory ID returned by save_project_agent_memory or list_project_agent_memories.") }),
  });

  const update = tool(async ({ id, content, tags, title }) => {
    try {
      const memory = await updateProjectAgentMemory(projectPath, id, { content, tags, title });
      return `Project-agent memory "${memory.id}" updated.\nTitle: ${memory.title}\nTags: ${memory.tags.join(", ")}`;
    } catch (error) {
      return `Error: The project-agent memory could not be updated. ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "update_project_agent_memory",
    description: "Updates an existing project-agent memory by exact ID. Only use when the user explicitly asks to change a saved memory; omit fields that should remain unchanged.",
    schema: z.object({
      id: z.string().trim().min(1).describe("Exact memory ID."),
      content: contentSchema.optional().describe("New full memory content; omit to keep current content."),
      tags: tagSchema.optional().describe("Replacement tag list; omit to keep current tags."),
      title: z.string().trim().min(1).max(120).optional().describe("New title; omit to keep the current title."),
    }),
  });

  const remove = tool(async ({ id }) => {
    try {
      await deleteProjectAgentMemory(projectPath, id);
      return `Project-agent memory "${id}" deleted.`;
    } catch (error) {
      return `Error: The project-agent memory could not be deleted. ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "delete_project_agent_memory",
    description: "Deletes a project-agent memory by exact ID. Only delete when the user clearly asks to remove that saved memory.",
    schema: z.object({ id: z.string().trim().min(1).describe("Exact memory ID." ) }),
  });

  const list = tool(async () => {
    try {
      const memories = await listProjectAgentMemories(projectPath);
      if (!memories.length) return "No project-agent memories are saved for this project yet.";
      return memories.map((memory) => `- ${memory.id} | ${memory.title} | tags: ${memory.tags.join(", ")}`).join("\n");
    } catch (error) {
      return `Error: Project-agent memories could not be listed. ${error instanceof Error ? error.message : String(error)}`;
    }
  }, {
    name: "list_project_agent_memories",
    description: "Lists saved project-agent memories with IDs, titles, and tags. Call before reading, updating, or deleting when the exact ID is unknown.",
    schema: z.object({}),
  });

  return [save, read, update, remove, list] as const;
}
