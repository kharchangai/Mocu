export type SpecialistSlashCommandName = 'focus' | 'step';

export interface SpecialistSlashCommand {
  command: SpecialistSlashCommandName;
  task: string;
}

/** Parses explicit commands that start a specialist session. */
export function parseSpecialistSlashCommand(
  message: string,
): SpecialistSlashCommand | null {
  const match = message.trim().match(/^\/(focus|step)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;

  return {
    command: match[1].toLowerCase() as SpecialistSlashCommandName,
    task: (match[2] ?? '').trim(),
  };
}
