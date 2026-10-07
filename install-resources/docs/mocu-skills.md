---
id: mocu-skills
title: Mocu Skills
description: Explains Mocu’s reusable, on-demand skills, their `SKILL.md` format
  and global storage, and how to create, install, select, and load them.
  Retrieve it for questions about managing or using skills; skills are distinct
  from agents and extensions.
keywords:
  - Mocu skills
  - skill
  - SKILL.md
  - skill-creator
  - load_skill
  - /skill command
  - create skill
  - install skill ZIP
  - global skills
  - Skills page
  - skill instructions
  - agents and extensions
---
# Mocu Skills

## What a skill is

A **skill** is a reusable package of instructions that teaches Mocu how to handle a specific kind of task, such as reviewing code, writing in a particular style, or running a build. Skills are plain Markdown files loaded **on demand**: the agent initially sees only each skill’s name and description, and reads the full instructions only when it decides a skill is relevant. This keeps the conversation context small.

A skill is not an agent or an extension. Do not conflate these concepts: a skill is an instruction package that can be selected for a request and loaded by the agent.

## The `SKILL.md` format and storage

Every skill is a folder containing a file named exactly `SKILL.md`. The file must begin on its first line with valid YAML frontmatter containing `name` and `description`, followed by the skill instructions:

```markdown
---
name: my-skill
description: Explain what the skill does and when it should activate.
---
# My Skill Instructions

...the full instructions the agent should follow...
```

Requirements for a valid skill:

- The file is named exactly `SKILL.md` and starts with `---`.
- Its frontmatter contains valid `name` and `description` fields.
- The folder name matches the frontmatter `name` (slugified).
- Supporting files, such as scripts, examples, and templates, are kept inside the same skill folder. Every referenced file must exist there.
- Skills are global and are stored at `<Mocu app-data>/com.mocu.app/skills/<skill-name>/SKILL.md`. Do not store skills in project-local or custom locations.

Mocu includes a built-in `skill-creator` skill for writing and validating skills. You can ask Mocu to create or update skill instructions. If you want the resulting skill package installed for use across Mocu, explicitly ask for it to be saved globally: drafting instructions and saving them into the global skills folder are distinct steps.

## Managing skills in the Skills page

The **Skills** page in the sidebar manages global skills, which are available across Mocu and are not limited to the currently open project. It lets you:

- **Create** a skill using the New Skill dialog by providing its name, description, and instructions.
- **Edit** an existing skill’s `SKILL.md` in the editor.
- **Install** a skill from a ZIP archive. The ZIP must contain a valid skill folder with `SKILL.md`; unsafe paths are rejected.
- **Delete** a skill.
- **Search** skills by name, description, or metadata.

## Selecting and using skills in chat

Type **`/skill`** in the chat input to open the skill list and attach a skill to the current message. A selected skill applies **only to that request**; it is not automatically attached to later requests.

You can also ask Mocu in plain language to create or update skill instructions. For this, the agent can use the built-in `skill-creator` skill. Explicitly request global saving if you want the generated package installed and available across Mocu.

Skills provide task instructions but do not override system instructions or security rules.

## How the agent loads skills

When skills are available, the agent initially sees their names and descriptions. If it decides a skill is relevant, it calls the **`load_skill`** tool with the skill’s exact name to receive the full `SKILL.md` content, then follows those instructions for the task.

The agent should not claim it used a skill unless it actually loaded it. It should not reproduce the full skill text in its reply unless asked.

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Chat, Slash Commands, Focus and Step-by-Step](mocu-chat-commands.md) — the `/skill` command
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — `load_skill` parameters
- [Mocu Agents](mocu-agents.md) — agents can also be bound to skills

## When to use this document

Retrieve this document when a user asks what Mocu skills are, how to create or validate a skill, what belongs in `SKILL.md`, where skills are stored, how to save one globally, or how to install, edit, delete, search for, select, or load a skill. It also applies when clarifying that skills are distinct from agents and extensions.
