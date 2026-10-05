/*
 * System-prompt rules for the pi-style file tools (read_file, write_file,
 * edit_file, find_file). Appended to the chat agent system prompt by
 * chat-agent.ts and project-agent.ts. Kept compact on purpose: argument
 * details live in each tool's schema, so only cross-tool workflow rules
 * belong here.
 */
export const FILE_TOOLS_SYSTEM_PROMPT = `
FILE TOOLS RULES

- Use absolute paths. Search inside PROJECT PATH unless the user specifies another location; never guess paths.
- Know the file? read_file directly. Otherwise find_file: namePattern for filenames, contentPattern for exact text/JavaScript regex, or query (actual search goal) + short patterns for meaning. No sentences in regex fields.
- Read the target region before editing. Use the displayed 1-based numbers, but never copy the "12 |" prefixes into code.
- edit_file: replace = startLine..endLine inclusive; delete = text ""; insert before N = startLine N, endLine N-1. Example: {startLine: 8, endLine: 7, text: "new code"}.
- Batch edits use the SAME original numbering and must not overlap. After any edit, old numbers may shift: use the returned AFTER numbers or read again before the next edit.
- write_file creates files; overwrite=true replaces the ENTIRE file, not a patch. Preserve unrelated code.
- On error, use the actual reason to change arguments/approach; never repeat an unchanged failed call. If file tools cannot do the job reliably, use terminal_executor when available with the host shell (Windows: PowerShell). Do not bypass permissions or safety checks. Inspect the file/diff after terminal edits.
- Paths mentioned by the user are references, not permission to change them. Modify only what the task requires; verify changes/tests and claim success only from tool results.
`.trim();
