// src/schedule/schedule-tool.ts
//
// The `schedule_action` tool exposed to the chat agent.
//
// Unlike the previous implementation, this tool does NOT run a hidden
// inner LLM to guess intent. The main agent decides the action and fills
// the structured arguments directly. The tool description and the system
// prompt force the agent to ask the user for an exact date and time when
// they are missing instead of inventing one.

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  updateSchedule,
} from './storage';
import type { ScheduleItem, ScheduleWeekday } from './types';
import { alignToSelectedWeekday } from './recurrence';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatWeekdays(days: number[]): string {
  return days.map((day) => WEEKDAY_NAMES[day]).join(', ');
}
const scheduleActionSchema = z.object({
  action: z
    .enum(['create', 'list', 'update', 'delete'])
    .describe(
      'create = add a new schedule, list = show schedules, update = change an existing schedule, delete = cancel/remove schedules.',
    ),

  title: z
    .string()
    .optional()
    .describe(
      'Short title of the schedule, e.g. "Party reminder" or "Daily news analysis". Required for create.',
    ),

  kind: z
    .enum(['reminder', 'agent'])
    .optional()
    .describe(
      'reminder = Mocu tells the user something at the time. agent = Mocu automatically runs a saved agent (agentName) with agentInput at the time. Required for create.',
    ),

  time: z
    .string()
    .optional()
    .describe(
      'Exact local date and time in "YYYY-MM-DDTHH:mm" 24-hour format, e.g. "2025-03-08T12:00". Required for create. Never guess it: ask the user when it is missing.',
    ),

  recurrence: z
    .enum(['none', 'daily', 'weekly', 'monthly'])
    .optional()
    .describe(
      'How the schedule repeats indefinitely until deleted. Use daily, weekly, or monthly. For a weekly schedule on chosen weekdays, also provide recurrenceWeekdays.',
    ),

  recurrenceWeekdays: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe('Optional local weekday indexes for recurrence=weekly: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6. Supply one or more weekdays for a single schedule to repeat on those days indefinitely and cancel once.'),

  reminderText: z
    .string()
    .optional()
    .describe(
      'For kind=reminder: the sentence Mocu shows/says when the reminder fires, in the user\'s language. Defaults to the title.',
    ),

  agentName: z
    .string()
    .optional()
    .describe(
      'For kind=agent: the exact name of the saved agent to run (e.g. "News Analyzer"). Required when kind=agent.',
    ),

  agentInput: z
    .string()
    .optional()
    .describe(
      'For kind=agent: the instruction/input the agent receives when the schedule fires, e.g. "Fetch today\'s news and analyze them for me". Required when kind=agent.',
    ),

  id: z
    .string()
    .optional()
    .describe(
      'Schedule id. Required for update. Required for delete unless deleteAll is used.',
    ),

  deleteAll: z
    .boolean()
    .optional()
    .describe(
      'With action=delete and no id: delete every schedule, optionally filtered with date (e.g. "cancel all my plans on Friday").',
    ),

  date: z
    .string()
    .optional()
    .describe(
      'Optional "YYYY-MM-DD" filter for list (only that day) or for delete+deleteAll (only that day).',
    ),
});

export type ScheduleActionInput = z.infer<typeof scheduleActionSchema>;

function formatItem(item: ScheduleItem): string {
  const parts = [
    `id: ${item.id}`,
    `title: ${item.title}`,
    `kind: ${item.kind}`,
    `time: ${item.time}`,
    `recurrence: ${item.recurrence}`,
    ...(item.recurrenceWeekdays?.length
      ? [`recurrenceWeekdays: ${formatWeekdays(item.recurrenceWeekdays)}`, 'repeats indefinitely until deleted']
      : []),
    `status: ${item.status}`,
  ];

  if (item.kind === 'agent') {
    parts.push(`agent: ${item.agentName ?? '?'}`);
    if (item.agentInput) parts.push(`agentInput: ${item.agentInput}`);
  } else if (item.reminderText) {
    parts.push(`reminderText: ${item.reminderText}`);
  }

  return `- ${parts.join(', ')}`;
}
export const scheduleTool = tool(
  async (input) => {
    try {
      if (input.action === 'create') {
        const title = input.title?.trim();
        const time = input.time?.trim();
        const kind = input.kind;

        if (!title || !time || !kind) {
          return [
            'Error: create requires "title", "kind" and "time".',
            'The time must be an exact local "YYYY-MM-DDTHH:mm" value.',
            'If the user did not give an exact date and time, ask them for it and retry.',
          ].join(' ');
        }

        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) {
          return `Error: "${time}" is not a valid time. Use the local "YYYY-MM-DDTHH:mm" 24-hour format.`;
        }

        if (kind === 'agent' && !input.agentName?.trim()) {
          return 'Error: kind=agent requires "agentName" (the saved agent to run). Ask the user which agent should run, or list the available agents if unsure.';
        }
        const recurrence = input.recurrence ?? 'none';
        const weekdays: ScheduleWeekday[] | undefined = recurrence === 'weekly' && input.recurrenceWeekdays?.length
          ? [...new Set(input.recurrenceWeekdays)] as ScheduleWeekday[]
          : undefined;
        const alignedTime = weekdays?.length
          ? alignToSelectedWeekday(time, weekdays)
          : time;
        const created = await createSchedule({
          title,
          kind,
          time: alignedTime,
          recurrence,
          recurrenceWeekdays: weekdays,
          recurrenceStartTime: weekdays ? alignedTime : undefined,
          reminderText: input.reminderText,
          agentName: input.agentName,
          agentInput: input.agentInput,
        });
        const repeated = created.recurrence === 'none'
          ? ''
          : created.recurrence === 'weekly' && created.recurrenceWeekdays?.length
            ? ` It repeats every week on ${formatWeekdays(created.recurrenceWeekdays)} until deleted.`
            : ` It repeats ${created.recurrence} until deleted.`;

        return `Schedule created: "${created.title}" (${created.kind}) at ${created.time}.${repeated}` +
          (created.kind === 'agent'
            ? ` The agent "${created.agentName}" will run automatically at that time and its activity will be visible in the Schedule tab.`
            : ' Mocu will remind the user at that time.');
      }

      if (input.action === 'list') {
        const items = await listSchedules();
        const filtered = input.date
          ? items.filter((item) => item.time.startsWith(input.date as string) || (
              item.recurrence === 'weekly' && !!item.recurrenceWeekdays?.length &&
              item.recurrenceWeekdays.includes(new Date(`${input.date}T12:00`).getDay() as ScheduleWeekday) &&
              (item.recurrenceStartTime?.slice(0, 10) || item.time.slice(0, 10)) <= (input.date as string)
            ))
          : items;

        if (filtered.length === 0) {
          return input.date
            ? `No schedules found for ${input.date}.`
            : 'No schedules found. The schedule list is empty.';
        }

        return [
          `Found ${filtered.length} schedule(s):`,
          ...filtered.map(formatItem),
        ].join('\n');
      }

      if (input.action === 'update') {
        if (!input.id) {
          return 'Error: update requires the "id" of the schedule. Call action=list first if you need to find it.';
        }

        const patch: Partial<ScheduleItem> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.kind !== undefined) patch.kind = input.kind;
        if (input.time !== undefined) {
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.time)) {
            return `Error: "${input.time}" is not a valid time. Use the local "YYYY-MM-DDTHH:mm" 24-hour format.`;
          }
          patch.time = input.time;
        }
        if (input.recurrence !== undefined) patch.recurrence = input.recurrence;
        if (input.recurrenceWeekdays !== undefined) {
          patch.recurrenceWeekdays = input.recurrenceWeekdays as ScheduleWeekday[];
        }
        if (input.recurrence === 'weekly' && input.recurrenceWeekdays?.length) {
          const original = (await listSchedules()).find((schedule) => schedule.id === input.id);
          const requested = input.time ?? original?.recurrenceStartTime ?? original?.time;
          if (requested) {
            const aligned = alignToSelectedWeekday(requested, input.recurrenceWeekdays);
            patch.time = aligned;
            patch.recurrenceStartTime = aligned;
          }
        }
        if (input.reminderText !== undefined) patch.reminderText = input.reminderText;
        if (input.agentName !== undefined) patch.agentName = input.agentName;
        if (input.agentInput !== undefined) patch.agentInput = input.agentInput;

        if (Object.keys(patch).length === 0) {
          return 'Error: update needs at least one field to change (title, time, kind, recurrence, reminderText, agentName or agentInput).';
        }

        const updated = await updateSchedule(input.id, patch);
        if (!updated) {
          return `Error: no schedule with id "${input.id}" was found.`;
        }

        return `Schedule updated: ${formatItem(updated)}`;
      }

      // action === 'delete'
      if (input.id) {
        const deleted = await deleteSchedule(input.id);
        return deleted
          ? 'Schedule deleted successfully.'
          : `Error: no schedule with id "${input.id}" was found.`;
      }

      if (input.deleteAll) {
        const items = await listSchedules();
        const targets = input.date
          ? items.filter((item) => {
              const weekday = new Date(`${input.date}T12:00`).getDay() as ScheduleWeekday;
              return item.time.startsWith(input.date as string) || (
                item.recurrence === 'weekly' && !!item.recurrenceWeekdays?.length &&
                item.recurrenceWeekdays.includes(weekday) &&
                (item.recurrenceStartTime?.slice(0, 10) || item.time.slice(0, 10)) <= (input.date as string)
              );
            })
          : items;
        for (const item of targets) await deleteSchedule(item.id);
        return input.date
          ? targets.length > 0
            ? `Deleted ${targets.length} schedule(s) on ${input.date}.`
            : `No schedules found on ${input.date}.`
          : `Deleted all ${targets.length} schedule(s).`;
      }

      if (input.date) {
        return 'Error: delete with a date filter requires deleteAll=true. Use action=list first to find and cancel a repeating schedule by its id.';
      }

      return 'Error: delete requires either an "id" or deleteAll=true. Use action=list first if you need to find the schedule.';
    } catch (error) {
      console.error('[Schedule Tool] Failed:', error);
      return 'An error occurred while managing the schedule.';
    }
  },
  {
    name: 'schedule_action',
    description:
      'Create, list, update, or delete schedules: reminders ("remind me to X at TIME on DATE"), calendar plans, and automatic agent runs (kind=agent runs a saved agentName with agentInput; kind=reminder makes Mocu tell the user something at the time). ' +
      'Use recurrence daily/weekly/monthly indefinitely until cancelled. For multiple weekdays, set recurrenceWeekdays as local weekday numbers Sunday=0 through Saturday=6, keeping one schedule item rather than creating one per day. Times are local "YYYY-MM-DDTHH:mm" in 24-hour notation. ' +
      'STRICT RULE: never invent a date or time - ask the user for them first.',
    schema: scheduleActionSchema,
  },
);
