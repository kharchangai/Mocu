// src/schedule/scheduler.ts
//
// The schedule trigger engine.
//
// The engine runs in the chat window (the main webview). Every few
// seconds it checks the saved schedules and, when a time is due:
//
//   - reminder  -> marks the item done (or reschedules it when it
//                  repeats) and broadcasts a `mocu-schedule-reminder`
//                  Tauri event. The Mocu avatar window listens for that
//                  event and speaks the reminder out loud.
//   - agent     -> runs the saved agent with the stored input through
//                  the normal agent runner, records a step-by-step run
//                  log (tool calls, results, final answer), then marks
//                  the item completed or reschedules it for recurrences.
//
// Runs that were due while the app was closed are executed as soon as
// the app starts (catch-up), so a "daily news analysis" is never lost
// just because Mocu was shut down for an evening.

import { emit } from '@tauri-apps/api/event';

import { runAgentByName } from '../chat/agent/agent-runner';

import {
  appendScheduleLogEntries,
  createScheduleLog,
  listSchedules,
  updateSchedule,
  updateScheduleLog,
} from './storage';
import type {
  ScheduleItem,
  ScheduleLogEntry,
  ScheduleRecurrence,
} from './types';

export const SCHEDULE_REMINDER_EVENT = 'mocu-schedule-reminder';
export const SCHEDULE_AGENT_COMPLETE_EVENT = 'mocu-schedule-agent-complete';

export type ScheduleReminderPayload = {
  scheduleId: string;
  title: string;
  text: string;
  time: string;
};

export type ScheduleAgentCompletionPayload = {
  scheduleId: string;
  title: string;
  agentName: string;
  status: 'completed' | 'failed';
  message: string;
};

const CHECK_INTERVAL_MS = 5000;
const MAX_CATCH_UP_DELAY_MS = 1000 * 60 * 60 * 24 * 7;

/*
 * Time helpers. Schedules use naive local ISO strings
 * ("YYYY-MM-DDTHH:mm") so the planner shows exactly what was picked.
 */
export function toLocalNaiveIso(date: Date): string {
  const pad = (value: number): string =>
    String(value).padStart(2, '0');

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function nextOccurrence(
  time: string,
  recurrence: ScheduleRecurrence,
): string | null {
  if (recurrence === 'none') {
    return null;
  }

  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  switch (recurrence) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      return null;
  }

  return toLocalNaiveIso(date);
}

function nextFutureOccurrence(
  time: string,
  recurrence: ScheduleRecurrence,
  now: Date,
): string | null {
  let next = nextOccurrence(time, recurrence);
  let attempts = 0;

  /* If Mocu was closed for several occurrences, skip straight to the
   * next future occurrence instead of replaying every missed run. */
  while (next && new Date(next).getTime() <= now.getTime() && attempts < 100) {
    next = nextOccurrence(next, recurrence);
    attempts += 1;
  }

  return next;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

export function startScheduler(): () => void {
  if (schedulerInterval !== null) {
    return () => stopScheduler();
  }

  schedulerInterval = setInterval(() => {
    void processDueSchedules();
  }, CHECK_INTERVAL_MS);

  void processDueSchedules();

  return () => stopScheduler();
}

export function stopScheduler(): void {
  if (schedulerInterval !== null) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

function isDue(item: ScheduleItem, now: Date): boolean {
  if (item.status !== 'pending') {
    return false;
  }

  const time = new Date(item.time);
  if (Number.isNaN(time.getTime())) {
    return false;
  }

  /*
   * Catch-up window: run anything due within the last week. Future
   * items must never fire early. Older items are left pending so the
   * user can still see and edit them in the planner.
   */
  const age = now.getTime() - time.getTime();
  return age >= 0 && age < MAX_CATCH_UP_DELAY_MS;
}

async function processDueSchedules(): Promise<void> {
  if (isProcessing) {
    return;
  }
  isProcessing = true;

  try {
    const schedules = await listSchedules();
    const now = new Date();
    const due = schedules.filter((item) => isDue(item, now));

    for (const item of due) {
      if (item.kind === 'reminder') {
        await fireReminder(item);
      } else {
        await runScheduledAgent(item);
      }
    }
  } catch (error) {
    console.error('[Scheduler] Failed to process schedules:', error);
  } finally {
    isProcessing = false;
  }
}

async function fireReminder(item: ScheduleItem): Promise<void> {
  const text = item.reminderText?.trim() || item.title;

  console.log(`[Scheduler] Reminder fired: ${item.title}`);

  await updateSchedule(item.id, {
    status: 'completed',
    lastRunAt: new Date().toISOString(),
  });

  const next = nextFutureOccurrence(item.time, item.recurrence, new Date());
  if (next) {
    await updateSchedule(item.id, {
      time: next,
      status: 'pending',
    });
  }

  try {
    await emit(SCHEDULE_REMINDER_EVENT, {
      scheduleId: item.id,
      title: item.title,
      text,
      time: item.time,
    } satisfies ScheduleReminderPayload);
  } catch (error) {
    console.error('[Scheduler] Failed to emit reminder event:', error);
  }
}

async function runScheduledAgent(item: ScheduleItem): Promise<void> {
  const agentName = (item.agentName ?? '').trim();

  if (!agentName) {
    await updateSchedule(item.id, {
      status: 'failed',
      lastRunAt: new Date().toISOString(),
      lastError: 'No agent name was saved on this schedule.',
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();

  console.log(`[Scheduler] Agent task fired: ${item.title} -> ${agentName}`);

  await updateSchedule(item.id, {
    status: 'running',
    lastRunAt: startedAt,
    lastError: undefined,
  });

  const triggerInput =
    item.agentInput?.trim() || item.title;

  const lateByMs = Date.now() - new Date(item.time).getTime();
  const introEntries: ScheduleLogEntry[] = [
    {
      time: startedAt,
      kind: 'info',
      message:
        `Scheduled agent "${agentName}" started for "${item.title}".` +
        (lateByMs > 60_000
          ? ` (Fired late by ${Math.round(lateByMs / 60_000)} minutes.)`
          : ''),
    },
    {
      time: startedAt,
      kind: 'info',
      message: `Input: ${triggerInput}`,
    },
  ];

  await createScheduleLog({
    id: runId,
    scheduleId: item.id,
    scheduleTitle: item.title,
    agentName,
    triggerInput,
    startedAt,
    status: 'running',
    entries: introEntries,
  });

  /*
   * Capture the tool calls the agent makes while it works so the
   * Schedule tab can show exactly what the agent did.
   */
  const onToolActivity = (event: Event): void => {
    const detail = (event as CustomEvent<{
      tool: string;
      args?: Record<string, unknown>;
      result?: string;
      status: 'running' | 'done' | 'error';
    }>).detail;

    if (!detail?.tool) {
      return;
    }

    const messageParts = [`Tool ${detail.tool} (${detail.status})`];
    if (detail.args && Object.keys(detail.args).length > 0) {
      messageParts.push(
        `args: ${JSON.stringify(detail.args).slice(0, 600)}`,
      );
    }
    if (typeof detail.result === 'string' && detail.result.trim()) {
      messageParts.push(
        `result: ${detail.result.slice(0, 600)}`,
      );
    }

    logWriteQueue = logWriteQueue
      .then(() =>
        appendScheduleLogEntries(runId, [
          {
            time: new Date().toISOString(),
            kind: detail.status === 'error' ? 'error' : 'tool',
            message: messageParts.join(' | '),
          },
        ]),
      )
      .catch((error) => {
        console.error('[Scheduler] Failed to append an agent log entry:', error);
      });
  };

  let logWriteQueue: Promise<void> = Promise.resolve();
  window.addEventListener('mocu_tool_activity', onToolActivity);

  let output = '';
  let runError: string | undefined;

  try {
    output = (
      await runAgentByName(agentName, triggerInput, '')
    ).trim();
  } catch (error) {
    runError =
      error instanceof Error ? error.message : String(error);
    console.error('[Scheduler] Scheduled agent run failed:', error);
  } finally {
    window.removeEventListener('mocu_tool_activity', onToolActivity);
  }

  await logWriteQueue;

  const finishedAt = new Date().toISOString();
  const entries: ScheduleLogEntry[] = [];

  if (runError) {
    entries.push({
      time: finishedAt,
      kind: 'error',
      message: `Agent run failed: ${runError}`,
    });
  } else {
    entries.push({
      time: finishedAt,
      kind: 'result',
      message: output || 'The agent finished without a final answer.',
    });
  }

  await appendScheduleLogEntries(runId, entries);
  const finalStatus = runError ? 'failed' : 'completed';
  await updateScheduleLog(runId, {
    finishedAt,
    status: finalStatus,
    output: runError ? undefined : output || undefined,
  });

  try {
    await emit(SCHEDULE_AGENT_COMPLETE_EVENT, {
      scheduleId: item.id,
      title: item.title,
      agentName,
      status: finalStatus,
      message: runError || output || 'The scheduled agent finished its work.',
    } satisfies ScheduleAgentCompletionPayload);
  } catch (error) {
    console.error('[Scheduler] Failed to emit agent completion event:', error);
  }

  const next = nextFutureOccurrence(item.time, item.recurrence, new Date());
  if (next) {
    await updateSchedule(item.id, {
      time: next,
      status: 'pending',
      lastError: runError,
    });
  } else {
    await updateSchedule(item.id, {
      status: runError ? 'failed' : 'completed',
      lastError: runError,
    });
  }
}
