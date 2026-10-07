---
id: mocu-notes
title: Mocu Notes
description: Explains how Mocu Notes store quick personal facts verbatim, how
  relevant notes are found and provided to the agent, and how to manage notes in
  the app or chat. Retrieve this document for questions about remembering facts
  or using notes.
keywords:
  - Mocu Notes
  - notes
  - personal facts
  - remember
  - saved verbatim
  - global notes folder
  - BM25 search
  - Notes page
  - save note
  - manage notes
  - knowledge docs
  - notes versus docs
---
# Mocu Notes

## What a note is

**Notes** are quick personal facts, preferences, and reminders that you want Mocu to remember. Notes are saved **exactly as you write them**—they are not rewritten or summarized—and live in the global notes folder (`<Mocu app-data>/notes`).

Use notes for things like “I prefer dark mode,” “my standup is at 10,” “the deploy command is …,” or “call the dentist.”

Unlike notes, [knowledge docs](mocu-knowledge-docs.md) are structured, searchable documents intended for reference material and guidance.

## How notes reach the agent

Before every answer, Mocu uses **BM25 keyword search** to find saved notes relevant to the current message. It provides the agent with matching notes, so the agent can use facts you previously shared when the conversation touches those topics.

## The Notes page

The **Notes** page in the sidebar lets you:

- **Create** a note with an optional title and body text.
- **Edit** a note’s title or text.
- **Delete** a note.
- **Search** your notes.

Note content is saved as written.

## Note tools in chat

The agent can manage notes using these tools:

| Tool | Purpose |
|---|---|
| `save_note` | Saves the provided text as a note without rewriting or summarizing it. |
| `read_note` | Reads the full content of one saved note by file name. |
| `update_note` | Updates a note’s title and/or text by file name; text is saved as given. |
| `delete_note` | Deletes a note by exact file name, when the user clearly asks. |
| `list_notes` | Lists saved notes with file names and titles. Use this first if the exact file name is unknown. |

Examples of requests you can make in chat:

- “Remember this: I prefer concise answers.”
- “Note that my deadline is Friday.”
- “What notes do I have about the API?”
- “Update the note ‘deploy.md’ with this: <text>.”
- “Delete the note ‘old.md’.”

## Notes versus knowledge docs

| | Notes | Knowledge docs |
|---|---|---|
| Format | Saved verbatim as written | Structured with a title, description, keywords, and explanation |
| Retrieval | BM25 search before every answer | Hybrid search (BM25 + embeddings + Jev), with full-body reads on demand |
| Best for | Quick facts, preferences, and reminders | Reference material, guides, and conventions the AI should follow |

## Related documents

- [Mocu Knowledge Docs](mocu-knowledge-docs.md) — structured knowledge documents
- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — full tool parameters

## When to use this document

Retrieve this document when the user asks how Mocu remembers personal facts, how notes differ from structured knowledge docs, or how to create, search, read, update, delete, or list notes in the app or from chat.
