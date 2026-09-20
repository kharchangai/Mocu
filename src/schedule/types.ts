// src/schedule/types.ts
//
// Core types for the Mocu schedule system.
//
// A schedule item is either a "reminder" (Mocu tells the user something
// at the given time) or an "agent" task (Mocu automatically runs a saved
// agent with a given input at the given time). Items can repeat daily,
// weekly, or monthly. Every agent run produces a log that the Schedule
// tab shows under "Completed agent tasks".

export type ScheduleKind = 'reminder' | 'agent';

export type ScheduleRecurrence =
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthly';

export type ScheduleStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export type ScheduleItem = {
  id: string;

  /** Short human-readable title, e.g. "Party reminder" or "Daily news analysis". */
  title: string;

  /** reminder = tell the user, agent = run a saved agent. */
  kind: ScheduleKind;

  /**
   * Local date and time in "YYYY-MM-DDTHH:mm" (naive ISO, 24-hour).
   * Stored without timezone so the planner UI shows exactly what the
   * user picked.
   */
  time: string;

  /** For kind = "agent": the saved agent to run. */
  agentName?: string;

  /** For kind = "agent": the instruction given to the agent when it fires. */
  agentInput?: string;

  /** For kind = "reminder": the sentence Mocu says/shows when it fires. */
  reminderText?: string;

  /** How the item repeats after it fires. */
  recurrence: ScheduleRecurrence;

  status: ScheduleStatus;

  createdAt: string;

  /** ISO timestamp of the last run (agent tasks and reminders). */
  lastRunAt?: string;

  /** Error message when a scheduled agent run failed. */
  lastError?: string;
};

export type ScheduleLogEntryKind =
  | 'info'
  | 'tool'
  | 'error'
  | 'result';

export type ScheduleLogEntry = {
  time: string;
  kind: ScheduleLogEntryKind;
  message: string;
};

export type ScheduleRunLogStatus =
  | 'running'
  | 'completed'
  | 'failed';

export type ScheduleRunLog = {
  id: string;

  scheduleId: string;

  scheduleTitle: string;

  agentName?: string;

  /** The input that was given to the agent when the schedule fired. */
  triggerInput: string;

  startedAt: string;

  finishedAt?: string;

  status: ScheduleRunLogStatus;

  /** Step-by-step what the agent did (tool calls, results, errors). */
  entries: ScheduleLogEntry[];

  /** Final answer produced by the agent. */
  output?: string;
};
