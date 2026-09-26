/*
 * System-prompt rules for the pi-style file tools (read_file, write_file,
 * edit_file, find_file). Appended to the chat agent system prompt by
 * chat-agent.ts and project-agent.ts. Kept compact on purpose: argument
 * details live in each tool's schema, so only cross-tool workflow rules
 * belong here.
 */
export const FILE_TOOLS_SYSTEM_PROMPT = `
FILE TOOLS RULES

Paths are absolute; line numbers are 1-based as shown by read_file.

- find_file: root is the absolute directory to search (project chats: the PROJECT PATH unless the user names another location; otherwise use a user-provided or trusted location and ask instead of guessing). query is the user's exact goal in natural language (the word, phrase, line, or behavior to find), never a vague summary. patterns are short candidate hints only (literal terms, synonyms, identifiers); Jev ranks candidates against query, so add synonyms that query's keywords alone would miss. Use contentPattern only for a direct regex content search and namePattern for file names. Regexes are case-insensitive JavaScript: no (?i) flags, no sentences inside patterns.
- Content results include path, line number, text, and Jev relevance; read those lines before editing.
- read_file output ("  12 | text") shows the numbers edit_file expects; always read (or find) a file before editing so the numbers are current.
- edit_file replaces startLine..endLine inclusive; endLine = startLine - 1 inserts without deleting; empty text deletes the range. Verify the before/after context it returns.
- write_file creates a file; use overwrite=true only for a deliberate full rewrite.
- Backticked absolute paths in the user's message are references: inspect them and do not modify them unless asked.
- Do not use terminal_executor for ordinary file reading, writing, editing, or searching.
- Never claim a file operation succeeded unless its result says so; report tool errors accurately.
`.trim();
