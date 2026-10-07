---
id: mocu-chat-commands
title: Mocu Chat Focus and Step-by-Step
description: Explains Mocu’s context-specific slash-command menu, built-in
  tools, and the project-chat-only Focus and Step-by-Step modes. Retrieve it
  when users ask which commands are available, how to start a specialist
  workflow, or how Focus and Step differ.
keywords:
  - Mocu chat commands
  - slash commands
  - command menu
  - normal chat
  - project chat
  - /skill
  - /extension
  - /agent
  - /mcp
  - /focus
  - /step
  - Focus mode
  - Step-by-Step
  - specialist session
  - project memory
---
# Mocu Chat Focus and Step-by-Step

## The chat input

The chat input is where you talk to Mocu. Besides plain text, it supports:

- **Slash commands:** Type `/` to reveal the commands available in the current chat.
- **Mentions and resource menus:** Attach files from the active project, or toggle skills, extensions, MCP servers, and agents for the current message from the input toolbar menus.
- **Model and effort selectors:** Choose which configured model tier answers and how much reasoning effort to use.

## Slash commands and chat context

The command menu is context-specific. The menu revealed by typing `/` is the authoritative source for what is available in the current chat.

| Chat type | Available commands |
|-----------|--------------------|
| Normal chat | `/skill`, `/extension`, `/agent`, `/mcp` |
| Project chat | `/skill`, `/extension`, `/agent`, `/mcp`, `/focus`, `/step` |

The resource commands work as follows:

| Command | What it does |
|---------|--------------|
| `/skill` | Opens your saved skills. Selecting one attaches it to the message so Mocu follows its instructions. |
| `/extension` | Opens your installed extensions. Selecting one exposes that extension’s tools for the request. |
| `/agent` | Opens your saved specialist agents. Selecting one delegates the request to that agent. |
| `/mcp` | Opens your connected MCP servers. Selecting one exposes that server’s tools for the request. |
| `/focus` | Starts a Focus session on a goal in project chat. |
| `/step` | Starts a Step-by-Step workflow on a task in project chat. |

`/focus` and `/step` can also appear at the end of a sentence, with the preceding text serving as the goal or task. In project chat, a natural-language phrase such as “let’s focus on …” can also start Focus mode.

**Focus and Step are project-chat-only.** They are not available in normal chat and are rejected there, even if entered as slash text. Open a project chat before trying to start either workflow. Since availability can change, check the menu shown after typing `/` rather than assuming a command is available.

## Built-in tools need no command

Mocu agents can use built-in tools without a slash command. These include file tools (`read_file`, `write_file`, `edit_file`, `find_file`), `terminal_executor`, `perplexity_search` for web search, `desktop_vision_action` to look at your screen, `text_to_speech` and `speech_control`, `load_skill`, `schedule_action`, `create_agent`, `list_agents`, `read_agent`, `update_agent`, and knowledge-document and note tools.

Ask for these capabilities in plain language—for example, “read this file,” “run this command,” “search the web,” or “remind me tomorrow at 9.” The agent can select the appropriate built-in tool. Slash commands are for selecting skills, extensions, MCP servers, or saved agents, and for starting Focus or Step in project chat; they are not required for built-in capabilities.

See [Mocu Built-in Tools Reference](mocu-tools-reference.md) for the full tool list and parameters.

## Focus mode (`/focus`)

Focus is a flexible specialist session for working toward one goal in user-controlled sections.

- **Project-chat only:** Open a project chat before starting Focus. The command is deliberately rejected in normal chat.
- **Start it:** Type `/focus <goal>`, put `/focus` at the end of a sentence describing the goal, or say “let’s focus on …” in project chat.
- **Work through sections:** The session opens the Focus panel. Work on the current section, then say **“next section”** to continue or **“end Focus”** to finish. You can add sections as work unfolds; no upfront plan is required.
- **Project-memory handoffs:** After each completed section, a compact summary is saved in project memory as a tagged handoff (`Memory tag: mocu:specialist:focus:<sessionId>:<sectionNumber>`). Later sections and project-chat messages receive relevant summaries rather than the full transcript. These compact handoffs reduce context carried forward and help control token cost.
- **When to use it:** Choose Focus when you have a goal and want to decide or add sections as the work develops.

## Step-by-Step mode (`/step`)

Step-by-Step is a planned specialist workflow: Mocu first breaks a task into small steps, then works through them one at a time.

- **Project-chat only:** Open a project chat before starting Step. The command is deliberately rejected in normal chat.
- **Start it:** Type `/step <task>`. Mocu creates and displays a plan; review the plan, then send a message when ready to begin step 1.
- **Work through the plan:** The active step is highlighted, and the UI shows status, history, and logs. Send a message to proceed. You can also cancel or resume the workflow.
- **Project-memory handoffs:** After each completed step, a compact summary is stored in project memory as a tagged handoff (`mocu:specialist:step-by-step:...`). Previous steps are represented by compact summaries rather than full transcripts, reducing carried context and token cost. A per-step `read_step_memory` tool can read that step’s own memory.
- **Keep steps small:** Each completed step is summarized before the next model call. Smaller steps make handoffs shorter and lower token cost.
- **When to use it:** Choose Step when you want a plan of small steps before execution.

## Focus versus Step

Both modes are project-chat-only specialist workflows and save compact, tagged handoffs to project memory as work is completed. Focus starts with a goal and lets you add sections as work unfolds. Step starts with a plan of small steps and proceeds through that plan one step at a time.

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — overview of the app and its pages
- [Mocu Projects](mocu-projects.md) — project chat, project memory, and specialist memory tags
- [Mocu Skills](mocu-skills.md) — `/skill` and the Skills page
- [Mocu Extensions](mocu-extensions.md) — `/extension` and the Extensions page
- [Mocu MCP Servers](mocu-mcp.md) — `/mcp` and the MCP page
- [Mocu Agents](mocu-agents.md) — `/agent` and the Agents page
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — agent tools and parameters

## When to use this document

Retrieve this document when a user asks which Mocu commands appear in normal chat versus project chat, how the slash-command menu works, whether built-in tools such as terminal or document tools need commands, or how to start, use, or distinguish Focus and Step-by-Step specialist workflows.
