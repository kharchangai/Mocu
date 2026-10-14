import type { ScheduleRecurrence } from './types';

function parseLocalDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date;
}

function normalizeWeekdays(weekdays?: number[]): number[] {
  return [...new Set((weekdays ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);
}

function toLocalNaiveIso(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Move a weekly multi-day schedule to its first selected day on or after its start date. */
export function alignToSelectedWeekday(time: string, weekdays?: number[]): string {
  const date = parseLocalDateTime(time);
  const days = normalizeWeekdays(weekdays);
  if (!date || days.length === 0 || days.includes(date.getDay())) return time;

  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(date);
    candidate.setDate(date.getDate() + offset);
    if (days.includes(candidate.getDay())) return toLocalNaiveIso(candidate);
  }
  return time;
}

/** Return the next local occurrence. With no weekdays, weekly retains its legacy every-7-days behavior. */
export function nextScheduleOccurrence(
  time: string,
  recurrence: ScheduleRecurrence,
  weekdays?: number[],
): string | null {
  if (recurrence === 'none') return null;

  const date = parseLocalDateTime(time);
  if (!date) return null;

  switch (recurrence) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;
    case 'weekly': {
      const days = normalizeWeekdays(weekdays);
      if (days.length === 0) {
        date.setDate(date.getDate() + 7);
        break;
      }
      for (let offset = 1; offset <= 7; offset += 1) {
        const candidate = new Date(date);
        candidate.setDate(date.getDate() + offset);
        if (days.includes(candidate.getDay())) return toLocalNaiveIso(candidate);
      }
      return null;
    }
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      return null;
  }

  return toLocalNaiveIso(date);
}

export function nextFutureScheduleOccurrence(
  time: string,
  recurrence: ScheduleRecurrence,
  now: Date,
  weekdays?: number[],
): string | null {
  let next = nextScheduleOccurrence(time, recurrence, weekdays);
  let attempts = 0;
  /* Skip missed occurrences, while bounding malformed or very old data. */
  while (next && new Date(next).getTime() <= now.getTime() && attempts < 10000) {
    next = nextScheduleOccurrence(next, recurrence, weekdays);
    attempts += 1;
  }
  return next;
}

/** True when a weekly schedule is due on this local calendar date. */
export function occursOnLocalDate(time: string, weekdays: number[] | undefined, date: Date): boolean {
  const start = time.slice(0, 10);
  const dayKey = toLocalNaiveIso(date).slice(0, 10);
  const days = normalizeWeekdays(weekdays);
  return date.getTime() >= 0 && dayKey >= start && (days.length === 0 || days.includes(date.getDay()));
}

export function selectedWeekdays(weekdays?: number[]): number[] {
  return normalizeWeekdays(weekdays);
}
