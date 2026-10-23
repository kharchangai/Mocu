/**
 * Built-in tools a saved specialist agent can receive from agent-runner.ts.
 * Keep this list aligned with the core tools registered by runAgentNode.
 * Extension, MCP, skill, and child-agent selections are configured separately.
 */
export const AGENT_TOOL_CATALOG = [
  {
    name: "terminal_executor",
    description:
      "Run terminal, shell, or command-line commands to inspect, build, test, or operate on the project and files.",
  },
  {
    name: "filesystem",
    description:
      "Read and search project files, create new files, and edit existing files using read_file, find_file, write_file, and edit_file.",
  },
  {
    name: "documents",
    description:
      "Create, list, read, update, and delete saved knowledge documents (docs), using the knowledge-document tools.",
  },
  {
    name: "notes",
    description:
      "Save, list, read, update, and delete the user's saved notes using the notes tools.",
  },
  {
    name: "perplexity_search",
    description:
      "Search the live web for current information, sources, news, and factual research.",
  },
  {
    name: "summarize_text",
    description:
      "Summarize supplied text using the separately configured Summarize LLM, with optional instructions for the summary format and level of detail.",
  },
  {
    name: "extract_entities",
    description:
      "Extract named entities from text using the configured Extract LLM; specify entity types and descriptions, and optionally confidence threshold and result limit.",
  },
  {
    name: "load_skill",
    description:
      "Load the full instructions of a selected skill by its exact name.",
  },
  {
    name: "find_relevant_skills",
    description:
      "Find installed skills relevant to a user request by asking Mocu's Decision model to match the request against skill names and descriptions; returns matching names and descriptions.",
  },
  {
    name: "schedule_action",
    description:
      "Create, list, update, or delete reminders, schedules, and scheduled agent runs.",
  },
  {
    name: "desktop_vision_action",
    description:
      "Capture and analyze the user's full primary monitor to identify visible interface elements and exact coordinates.",
  },
] as const;

export type AgentToolName = (typeof AGENT_TOOL_CATALOG)[number]["name"];
