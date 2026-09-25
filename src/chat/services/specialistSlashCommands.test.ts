import { describe, expect, it } from 'vitest';
import { parseSpecialistSlashCommand } from './specialistSlashCommands';

describe('parseSpecialistSlashCommand', () => {
  it.each([
    ['/focus Fix the parser', { command: 'focus', task: 'Fix the parser' }],
    ['/STEP Write tests', { command: 'step', task: 'Write tests' }],
    ['/focus', { command: 'focus', task: '' }],
  ])('parses %s', (input, expected) => {
    expect(parseSpecialistSlashCommand(input)).toEqual(expected);
  });

  it.each([
    ['Please focus on the parser'],
    ['/focusful task'],
    ['ordinary /step text'],
  ])('does not parse %s', (input) => {
    expect(parseSpecialistSlashCommand(input)).toBeNull();
  });
});
