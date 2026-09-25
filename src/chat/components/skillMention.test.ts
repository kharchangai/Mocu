import { describe, expect, it } from 'vitest';
import { findActiveSlashCommand } from './skillMention';

describe('findActiveSlashCommand', () => {
  it('keeps the command menu active while typing a command prefix', () => {
    expect(findActiveSlashCommand('/ag', 3)).toEqual({
      start: 0,
      end: 3,
      command: 'ag',
      query: '',
    });
  });

  it('opens subcommand completion after a command and trailing space', () => {
    expect(findActiveSlashCommand('/agent ', 7)).toEqual({
      start: 0,
      end: 7,
      command: 'agent',
      query: '',
    });
  });

  it('captures a query after the subcommand', () => {
    expect(findActiveSlashCommand('/agent code reviewer', 20)).toEqual({
      start: 0,
      end: 20,
      command: 'agent',
      query: 'code reviewer',
    });
  });
});
