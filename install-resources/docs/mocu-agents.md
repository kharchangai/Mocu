---
id: mocu-agents
title: Mocu Agents
description: Explains Mocu’s saved specialist agents, their definition fields,
  how to create and manage them, and how they relate to skills, extensions, MCP,
  and scheduled runs. Retrieve it for questions about saved agents, delegation,
  agent tools, creation, management, or scheduling.
keywords:
  - Mocu agents
  - saved agent
  - specialist agent
  - create an agent
  - create_agent
  - /agent command
  - agent tools
  - agent skills
  - sub-agents
  - agent model
  - delegate to agent
  - update_agent
  - list_agents
  - read_agent
  - schedule agent run
---
# Mocu Agents

## What an agent is

A **saved specialist agent** is a reusable AI persona defined once and invoked from chat. Each agent has a definition with these fields:

- **agentName** — the agent’s exact name, used to select it.
- **description** — a short summary of what it does.
- **mainInstruction** — the system instruction that defines its behavior.
- **tools** — the exact built-in, extension, or MCP tool names it may use.
- **skills** — skills bound to the agent.
- **agents** — other saved agents it can delegate to; these are its sub-agents.
- **extensions** — extensions enabled for it.
- **llm** — an optional specific model. An empty value means the default model.

Agents are stored under Mocu’s app-data `agents` folder and listed on the **Agents** page in the sidebar. There, users can create, edit, and delete agents.

## Using and delegating to agents

- Type **`/agent`** in the chat input to open the list of saved agents and delegate the current request to one.
- You can also ask in natural language, for example, “Ask my Code Reviewer agent to look at this.”
- Agents do **not** run autonomously in chat. They are offered to the model as callable tools, and the model invokes an agent when the request matches.

## Creating and managing agents from chat

When asked, the assistant can use agent-management tools:

- **“Create an agent that …”** — `create_agent` builds a structured definition from the requested description, selects exact supported tool names for the requested capabilities, and saves the agent.
- **“Show my agents”** — `list_agents` lists saved agents and summaries.
- **“Read the agent ‘Writer’”** — `read_agent` returns the agent’s full definition.
- **“Update the agent ‘Writer’ to …”** — `update_agent` changes only the requested fields; omitted fields are preserved.

Do not modify a saved agent unless the user explicitly asks.

## Agents and scheduling

A scheduled item of kind `agent` runs one saved agent automatically at a set time with a given input. For example: “Every morning at 8, run my News Analyzer agent with ‘summarize today’s tech news’.”

See [Mocu Schedule](mocu-schedule.md) for scheduled agent runs.

## Agents vs. skills, extensions, and MCP

| Resource | Role |
|---|---|
| **Agent** | A persona with its own instructions, tools, skills, sub-agents, and model. Users delegate requests to it. |
| **Skill** | Reusable instructions loaded on demand to guide a task. |
| **Extension** | Adds new tools (a program) the agent can call. |
| **MCP server** | Provides external tools via the MCP standard. |

An agent can combine these resources: it has its own tools, bound skills, enabled extensions, and can use selected MCP servers.

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Chat, Slash Commands, Focus and Step-by-Step](mocu-chat-commands.md) — the `/agent` command
- [Mocu Skills](mocu-skills.md) — skills bound to agents
- [Mocu Extensions](mocu-extensions.md) — extensions enabled for agents
- [Mocu MCP Servers](mocu-mcp.md) — MCP tools for agents
- [Mocu Schedule](mocu-schedule.md) — scheduled agent runs
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — agent-management tools

## When to use this document

Retrieve this document when a user asks what Mocu agents are, how to create, edit, delete, or delegate to a saved agent, how agent tools work, how agents relate to skills, extensions, or MCP, or how to schedule an agent run.
