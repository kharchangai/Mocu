export type SpecialistSlashCommandName = 'focus' | 'step';

export interface SpecialistSlashCommand {
  command: SpecialistSlashCommandName;
  task: string;
}

const LEADING_COMMAND_SEPARATORS = /^[\s\u200B-\u200F\u2060\uFEFF:：،,，。．、;؛؟!?！？_\-–—*•·)\]}«»"'’]+/;
const RTL_SPACING = "\\s\\u200B-\\u200F\\u2060\\uFEFF";

/** Parses explicit specialist commands at the start or end of a message. */
export function parseSpecialistSlashCommand(
  message: string,
): SpecialistSlashCommand | null {
  // Ignore invisible prefix characters sometimes added by copy/paste or RTL input.
  const text = message.replace(/^[\s\u200B-\u200F\u2060\uFEFF]+/, '').trim();
  const leadingMatch = text.match(/^\/(focus|step)(?![A-Za-z0-9_]|-[A-Za-z0-9_])([\s\S]*)$/i);
  if (leadingMatch) {
    let task = leadingMatch[2].replace(LEADING_COMMAND_SEPARATORS, '').trim();
    // Treat sentence punctuation after a bare command as no task, without
    // stripping meaningful dot-prefixed goals such as ".env support".
    task = task.replace(/^\.+(?=\s|$)/, '').trim();

    return {
      command: leadingMatch[1].toLowerCase() as SpecialistSlashCommandName,
      task,
    };
  }

  // Also accept an explicit command appended to a prompt, e.g. Persian/RTL
  // text followed by "/focus". The preceding text becomes the session goal.
  const trailingMatch = text.match(
    new RegExp(
      `^(.*?)[${RTL_SPACING}]+\\/(focus|step)(?![A-Za-z0-9_]|-[A-Za-z0-9_])[\\s\\u200B-\\u200F\\u2060\\uFEFF:：،,，。．、;؛؟.!?！？]*$`,
      "i",
    ),
  );
  if (!trailingMatch) return null;

  return {
    command: trailingMatch[2].toLowerCase() as SpecialistSlashCommandName,
    task: trailingMatch[1].trim(),
  };
}
