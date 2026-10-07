---
id: mocu-knowledge-docs
title: Mocu Knowledge Docs
description: Explains Mocu’s searchable global Markdown knowledge base, how
  documents are structured and retrieved, and how to manage them in the app or
  through chat tools. Retrieve it when users ask about docs, knowledge-base
  retrieval, or creating, reading, updating, deleting, and finding documents.
keywords:
  - Mocu Docs
  - knowledge documents
  - knowledge base
  - searchable Markdown
  - hybrid retrieval
  - BM25
  - embedding similarity
  - Jev reranking
  - create read update delete docs
  - knowledge-doc tools
  - Docs page
---
# Mocu Knowledge Docs

## What a knowledge doc is

The **Docs** feature is a personal knowledge base for the AI. A knowledge document is a searchable Markdown file with a title, description, keywords, and a full explanation. Documents are saved in the global docs folder: `<Mocu app-data>/docs`.

Use docs to give Mocu information it does not already have or that you want it to remember and use when answering, such as:

- User preferences
- Project conventions
- Reference material
- How-tos
- Other useful information for the agent

## How docs reach the agent

- **Automatic retrieval:** Before answering, Mocu searches saved docs for the current message using hybrid retrieval. Search combines BM25 keyword search and embedding similarity. Results may optionally be reranked by the Jev decision model.
- **Capped references:** Mocu injects only capped references containing document metadata, not full document bodies. The agent uses a tool to read the full body of a referenced document when it needs the details.
- **Configurable behavior:** Retrieval weights, thresholds, caps, and Jev usage are configurable in [Settings](mocu-settings.md).
- **On-demand access:** When asked, the agent can search for and read docs with tools—for example, “read my doc about X” or “find the doc that mentions Y.”

## The Docs page

The **Docs** page in the sidebar lets you:

- **Create** a doc from raw text. Mocu structures it into a title, description, keywords, and a full explanation.
- **Edit** an existing doc’s text or metadata.
- **Delete** a doc.
- **Search** docs with ranked search by entering a query, or browse the plain list.

For larger topics, use several focused docs instead of one long, mixed document. Markdown links between docs can guide readers to related details, but links are navigational hints only: the agent must explicitly read each linked document it needs. Following a link does not automatically load the target or recursively read linked docs. Link targets resolve relative to the linking document’s folder.

## Knowledge-doc tools for chat

The agent has five tools for managing docs from chat:

| Tool | Purpose |
|------|---------|
| `create_knowledge_doc` | Turns supplied text into a complete, searchable knowledge doc with a title, description, keywords, and full explanation. Pass the text as-is. |
| `read_knowledge_doc` | Reads exactly one doc, including its full metadata and body, by file name or docs-relative path. Follow Markdown links yourself by calling the tool again with `currentDoc` set. It does not crawl links or consult another model. |
| `update_knowledge_doc` | Updates a doc by file name. Pass new text to regenerate or merge the document, or provide only a description or keywords to edit metadata. |
| `delete_knowledge_doc` | Deletes a doc by exact file name, only when the user clearly asks. |
| `list_knowledge_docs` | Lists all docs with file names, titles, descriptions, and keywords. Call it first if you do not know the exact file name. |

**Security:** Doc reads reject path traversal, absolute paths, and anything outside the global docs folder.

Examples of requests you can make in chat:

- “Save this as a doc: `<text>`.”
- “Update the doc ‘my-idea.md’ with this: `<text>`.”
- “What docs do I have about the release process?”
- “Delete the doc ‘old-notes.md’.”

## Related documents

- [Mocu Notes](mocu-notes.md) — quick notes (shorter-lived, saved as-is)
- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Settings](mocu-settings.md) — docs retrieval and hybrid-search settings
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — full tool parameters

## When to use this document

Retrieve this document when a user asks about the Docs page, Mocu’s knowledge base, searchable knowledge documents, automatic or hybrid retrieval, BM25 or embedding search, Jev reranking, or creating, reading, updating, deleting, searching, or listing docs through the app or chat tools.
