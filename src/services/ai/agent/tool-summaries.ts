/*
 * Compact tool descriptions shared by the step-by-step and Focus executors.
 *
 * Both executors feed these strings into the system prompt AND bindTools, so
 * they are deliberately short: every line must carry the essential behavior
 * (including the cross-tool file rules) so we never need to append the big
 * FILE_TOOLS_SYSTEM_PROMPT block to those prompts. Argument details stay in
 * each tool's schema.
 */

const SHORT_TOOL_DESCRIPTIONS: Record<string, string> = {
  // Task tools (shared with the project agent).
  desktop_vision_action: "Inspect the user's screen when requested.",
  terminal_executor:
    "Run a shell command in the selected project. Do NOT use it for ordinary file reads, writes, edits, or searches; use the file tools.",
  perplexity_search: "Search the web for current information.",
  load_skill: "Load instructions for a selected skill.",
  read_file:
    "Read a file (1-based line numbers). Read (or find) before editing so line numbers are current.",
  write_file:
    "Create a file or fully rewrite it; pass overwrite=true only for a deliberate full rewrite.",
  edit_file:
    "Replace lines startLine..endLine inclusive (endLine = startLine - 1 inserts, empty text deletes); verify the returned diff.",
  find_file:
    "Find files/lines by natural-language query or regex (query = exact goal, patterns = hints). Read matched lines before editing.",
  schedule_action: "Create, list, update, or remove scheduled tasks.",
  text_to_speech: "Speak text aloud to the user.",
  speech_control: "Pause, resume, or stop speech output.",
  create_agent: "Create a new specialist agent.",
  save_note: "Save a user note.",
  read_note: "Read a user note.",
  update_note: "Update a user note.",
  delete_note: "Delete a user note.",
  list_notes: "List user notes.",
  create_knowledge_doc: "Create a knowledge document.",
  read_knowledge_doc: "Read a knowledge document.",
  update_knowledge_doc: "Update a knowledge document.",
  delete_knowledge_doc: "Delete a knowledge document when explicitly requested.",
  list_knowledge_docs: "List saved knowledge documents.",

  // Step-by-step workflow tools.
  read_step_logs: "Read workflow log summaries.",
  read_log_entry: "Read a specific workflow log entry.",
  read_step_memory: "Read a workflow step and its saved summary.",
  move_to_next_step: "Advance only when the user explicitly asks.",
  update_plan: "Update the plan only when the user explicitly asks.",
  finish_workflow: "End the workflow when the user explicitly asks.",

  // Focus tools.
  read_focus_section_memory: "Read a section's compact summary.",
  read_focus_section_history:
    "Search a section's stored history when its compact memory is not enough.",
  read_focus_history_entry:
    "Read one full history entry by ID when its preview was truncated.",
  record_focus_milestone:
    "Record only a significant result to carry between sections, not routine steps.",
  next_focus_section:
    "Advance only when the user explicitly asks; then stop all task work.",
  end_focus:
    "End Focus only when the user explicitly asks; then stop all task work.",
};

export function shortToolDescription(name: string): string {
  const known = SHORT_TOOL_DESCRIPTIONS[name];
  if (known) return known;
  if (name.startsWith("extension_")) return "Run a selected extension command.";
  if (name.startsWith("mcp_")) return "Call a selected MCP tool.";
  if (name.startsWith("agent_")) return "Delegate to a selected specialist agent.";
  return `Run the ${name} operation.`;
}

/**
 * Returns a proxy whose `description` is the compact summary. Works for any
 * LangChain tool-like object; every other property passes through untouched.
 */
export function withShortDescription<
  T extends { name: string; description: string },
>(item: T): T {
  return new Proxy(item, {
    get(target, property, receiver) {
      if (property === "description") {
        return shortToolDescription(target.name);
      }

      return Reflect.get(target, property, receiver);
    },
  });
}
