---
id: mocu-schedule
title: Mocu Schedule
description: Explains Mocu reminders, scheduled agent runs, recurrence, schedule
  management, and scheduler behavior. Retrieve it when a user asks how to create
  or manage schedules, schedule an agent, or understand when scheduled items
  run.
keywords:
  - Mocu Schedule
  - reminders
  - scheduled agent runs
  - recurrence
  - schedule_action
  - Schedule page
  - scheduler behavior
  - catch-up
  - spoken reminders
  - schedule management
---
# Mocu Schedule

## What scheduling does

The **Schedule** page, available from the sidebar, manages two kinds of scheduled items:

- **Reminder** (`kind: reminder`) — at the set time, Mocu shows the reminder text and speaks it aloud using the configured TTS voice.
- **Agent run** (`kind: agent`) — at the set time, Mocu automatically runs one of your saved specialist agents with the input you provide. For example: “Fetch today's news and analyze them for me.”

Both kinds support recurrence: `none`, `daily`, `weekly`, or `monthly`.

Times are stored as local `YYYY-MM-DDTHH:mm` values using the 24-hour clock.

## The Schedule page

From the Schedule page, you can:

- **Create** a reminder or agent run by choosing its kind, title, exact date and time, and recurrence. For an agent run, also choose the saved agent and provide its input.
- **List** schedules, optionally filtered to one day.
- **Update** an existing schedule, including its time, text, or recurrence.
- **Delete** one schedule or delete all schedules, optionally limited to one day.
- View the **log** of past schedule triggers, including reminders that fired and agent runs that completed or failed.

## Scheduling from chat

You can request a schedule in chat without opening the Schedule page. For example:

- “Remind me to call Sara tomorrow at 9am.”
- “Every day at 12, run my News Analyzer agent and summarize today's news.”
- “Show my schedules.”
- “Cancel my Friday plans.”

The agent uses the **`schedule_action`** tool, which supports `create`, `list`, `update`, and `delete` actions—the same operations available on the Schedule page. The agent chooses the action and fills in the structured arguments.

**Important:** The agent must never invent a date or time. If you have not provided an exact date and time, it asks you for them first.

## Triggering and catch-up behavior

When a scheduled agent run finishes, Mocu emits a completion event. When a reminder fires, Mocu emits a reminder event that the avatar speaks.

While Mocu is open, the scheduler checks regularly for due items. Schedules do not run in the background while the app is closed. When Mocu starts again, it catches up items that became due within the last seven days. Recurring items advance to their next future occurrence rather than replaying every missed run.

## Related documents

- [Mocu User Guide](mocu-user-guide.md) — app overview
- [Mocu Agents](mocu-agents.md) — saved agents a schedule can run
- [Mocu Built-in Tools Reference](mocu-tools-reference.md) — `schedule_action` parameters
- [Mocu Settings](mocu-settings.md) — TTS voice used for spoken reminders

## When to use this document

Retrieve this document when a user asks to set a reminder, schedule a task or agent run, or understand how scheduling, recurrence, or the Schedule page works. It is also relevant for questions about timers, cron-like plans, the `schedule_action` tool, schedules while Mocu is closed, catch-up behavior, or running an agent at a specific time.
