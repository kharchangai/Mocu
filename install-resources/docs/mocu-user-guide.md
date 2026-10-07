---
id: mocu-user-guide
title: Mocu User Guide
description: A practical overview of Mocu’s conversations, projects, sidebar
  pages, modes, and tools. Retrieve it for general how-to questions or an
  overview of Mocu features.
keywords:
  - Mocu user guide
  - how to use Mocu
  - Mocu features overview
  - Mocu sidebar pages
  - normal chat vs project chat
  - Mocu desktop assistant
  - start a Mocu conversation
  - create a Mocu project
  - Mocu slash commands
  - Focus mode
  - Step mode
  - Mocu built-in tools
  - Mocu schedule
  - Mocu skills and knowledge docs
  - Mocu settings
---
# Mocu User Guide

Mocu is a personal AI desktop assistant for Windows, macOS, and Linux, built with Tauri 2 (Rust backend) and React + TypeScript (frontend). It brings chat, projects, scheduling, memory, agents, skills, extensions, and MCP support together in one app. Mocu is model-agnostic: you provide an API key from an OpenAI-compatible provider.

## Choose a conversation type

Mocu has two kinds of conversation. Choose based on whether the work is quick and self-contained or tied to an ongoing project.

- **Normal chat** is for one-off tasks such as asking a question, translating, making a quick plan, or summarizing. It uses the general chat agent, its default built-in tools, and global long-term personal memory—information Mocu remembers about you across sessions. Normal conversations appear in **Chats**.
- **Project chat** is for long-running work associated with a folder on disk. Each project has its own chat history and project memory; episodes and turns are saved and retrieved per project. The project agent knows the project path, so terminal commands start in that folder by default. Projects are managed from **Projects**.

To start a normal conversation, choose **New chat** in the sidebar. To work in a project, open **Projects** and use a project workspace; see [Mocu Projects](mocu-projects.md) for the project workflow.

**Rule of thumb:** use normal chat for a quick question or task. Use project chat for ongoing work on a codebase or files in a specific folder, especially when work spans multiple sessions.

## Sidebar pages

The left sidebar is Mocu’s main navigation:

| Item | What it is |
|------|-----------|
| **Home** | The landing view of the app. |
| **New chat** | Starts a fresh normal chat conversation. |
| **Chats** | Lists previous normal conversations. Open one to resume it, rename it, or delete it. |
| **Projects** | Project workspaces with their own chat history and memory. See [Mocu Projects](mocu-projects.md). |
| **Schedule** | Reminders and scheduled agent runs. See [Mocu Schedule](mocu-schedule.md). |
| **Skills** | Reusable instruction packages the AI loads on demand. See [Mocu Skills](mocu-skills.md). |
| **Docs** | Searchable knowledge documents. See [Mocu Knowledge Docs](mocu-knowledge-docs.md). |
| **Notes** | Quick personal notes the AI remembers. See [Mocu Notes](mocu-notes.md). |
| **Extensions** | Installable add-ons that give the AI new tools. See [Mocu Extensions](mocu-extensions.md). |
| **MCP** | Connect external MCP servers to make their tools available. See [Mocu MCP Servers](mocu-mcp.md). |
| **Agents** | Create and manage custom specialist agents. See [Mocu Agents](mocu-agents.md). |
| **Settings** | Configure API keys, models, speech, and retrieval. See [Mocu Settings](mocu-settings.md). |

## Chat commands and specialist modes

Typing `/` in the chat input opens a menu of available slash commands. Mocu also has **Focus** and **Step-by-Step** modes for specialized ways of working. For command details and instructions on using these modes, see [Mocu Chat, Slash Commands, Focus and Step-by-Step](mocu-chat-commands.md).

## Asking Mocu to use tools

You can ask Mocu in chat to perform a task that uses an available tool. The general chat agent has default built-in tools; project chat also has the project path as context. Extensions and connected MCP servers can make additional tools available. For the built-in tool list and details, see [Mocu Built-in Tools Reference](mocu-tools-reference.md).

## First-run setup

On first launch, Mocu checks whether Node.js and Python are installed because some extensions need them. Configure an AI provider in **Settings** by entering an API key, base URL, and model names. Add a Perplexity API key in Settings if you want to use the web search tool.

## Related guides

- [Mocu Projects](mocu-projects.md) — project chat, project memory, and project workflow
- [Mocu Chat, Slash Commands, Focus and Step-by-Step](mocu-chat-commands.md) — chat commands and specialist modes
- [Mocu Schedule](mocu-schedule.md) — reminders and scheduled agent runs
- [Mocu Skills](mocu-skills.md) — skills and the Skills page
- [Mocu Knowledge Docs](mocu-knowledge-docs.md) — the Docs page and document tools
- [Mocu Notes](mocu-notes.md) — the Notes page and note tools
- [Mocu Extensions](mocu-extensions.md) — the extension system
- [Mocu MCP Servers](mocu-mcp.md) — connecting MCP servers
- [Mocu Agents](mocu-agents.md) — saved specialist agents
- [Mocu Settings](mocu-settings.md) — settings explained
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — tools the AI can call
- [Mocu Docs Map](mocu-docs-map.md) — choose the focused Mocu guide

## When to use this document

Retrieve this guide when someone asks how to use Mocu, how to start a conversation or project, how normal chat differs from project chat, what a sidebar page does, or wants a general overview of commands, modes, tools, scheduling, skills, docs, notes, extensions, MCP servers, agents, or settings.
