import { describe, expect, it } from 'vitest';

import {
  alignToSelectedWeekday,
  nextFutureScheduleOccurrence,
  nextScheduleOccurrence,
} from './recurrence';

describe('weekly schedule recurrence', () => {
  it('advances to the next selected weekday while retaining local time', () => {
    // Monday, 2026-10-12 at 08:00 -> Tuesday, 2026-10-13 at 08:00.
    expect(nextScheduleOccurrence('2026-10-12T08:00', 'weekly', [1, 2, 3, 4, 5]))
      .toBe('2026-10-13T08:00');
  });

  it('wraps across the weekend to the first weekday of the next week', () => {
    expect(nextScheduleOccurrence('2026-10-16T08:00', 'weekly', [1, 2, 3, 4, 5]))
      .toBe('2026-10-19T08:00');
  });

  it('keeps old weekly schedules on their original seven-day cadence', () => {
    expect(nextScheduleOccurrence('2026-10-12T08:00', 'weekly'))
      .toBe('2026-10-19T08:00');
  });

  it('aligns a requested start date to its next chosen weekday', () => {
    expect(alignToSelectedWeekday('2026-10-17T08:00', [1, 2, 3, 4, 5]))
      .toBe('2026-10-19T08:00');
  });

  it('skips missed selected weekdays to the next future occurrence', () => {
    expect(nextFutureScheduleOccurrence(
      '2026-10-12T08:00',
      'weekly',
      new Date(2026, 9, 14, 9, 0),
      [1, 2, 3, 4, 5],
    )).toBe('2026-10-15T08:00');
  });

  it('preserves legacy daily and monthly recurrence', () => {
    expect(nextScheduleOccurrence('2026-10-12T08:00', 'daily')).toBe('2026-10-13T08:00');
    expect(nextScheduleOccurrence('2026-10-12T08:00', 'monthly')).toBe('2026-11-12T08:00');
  });
});
