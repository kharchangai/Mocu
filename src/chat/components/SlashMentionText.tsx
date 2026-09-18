import type { ReactNode } from 'react';

type MentionCommand = 'skill' | 'extension' | 'agent';

export type MentionResourceNames = Partial<
  Record<MentionCommand, string[]>
>;

type SlashMentionTextProps = {
  content: string;
  className?: string;
  resourceNames?: MentionResourceNames;
};

/*
 * Keeps slash commands in the message while giving them a small amount of
 * syntax highlighting. The same renderer is used by the composer preview and
 * by sent user messages, so a selected resource never disappears from the
 * text the user typed.
 *
 * resourceNames is important for names such as "Ask LLM": a whitespace is
 * not necessarily the end of a resource name. The longest matching name is
 * used first so names that contain other names are handled correctly.
 */
export function SlashMentionText({
  content,
  className,
  resourceNames = {},
}: SlashMentionTextProps) {
  const parts: ReactNode[] = [];
  const commandPattern = /\/([a-zA-Z0-9_-]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  while ((match = commandPattern.exec(content)) !== null) {
    const matchStart = match.index;
    const previousCharacter = content[matchStart - 1];

    // A slash in a path or a URL is ordinary message text, not a command.
    if (previousCharacter && !/\s/.test(previousCharacter)) {
      continue;
    }

    const command = match[1].toLowerCase();
    const commandType: MentionCommand | 'error' =
      command === 'skill'
        ? 'skill'
        : command === 'extension'
          ? 'extension'
          : command === 'agent'
            ? 'agent'
            : 'error';

    const commandText = `/${match[1]}`;
    const commandEnd = matchStart + commandText.length;
    const whitespaceMatch = content
      .slice(commandEnd)
      .match(/^\s+/);
    const whitespace = whitespaceMatch?.[0] ?? '';
    const nameStart = commandEnd + whitespace.length;

    let mentionEnd = commandEnd;
    let name: string | undefined;
    let nameWhitespace = '';

    if (commandType !== 'error' && whitespace) {
      const candidates = [...(resourceNames[commandType] ?? [])]
        .filter((resourceName) => resourceName.trim().length > 0)
        .sort((first, second) => second.length - first.length);
      const remainingText = content.slice(nameStart);
      const normalizedRemainingText = remainingText.toLowerCase();

      const matchedCandidate = candidates.find((candidate) => {
        const normalizedCandidate = candidate.toLowerCase();
        const followsCandidate = remainingText[normalizedCandidate.length];

        return (
          normalizedRemainingText.startsWith(normalizedCandidate) &&
          (!followsCandidate || /\s|[.,!?;:)]/.test(followsCandidate))
        );
      });

      if (matchedCandidate) {
        name = remainingText.slice(0, matchedCandidate.length);
        mentionEnd = nameStart + matchedCandidate.length;
        nameWhitespace = whitespace;
      }
    }

    /*
     * When the text after the command does not match a known resource
     * name, only the "/command" token is highlighted. Older messages,
     * deleted resources, or typos must never color ordinary message
     * text as if it were part of a resource name.
     */

    if (matchStart > cursor) {
      parts.push(content.slice(cursor, matchStart));
    }

    parts.push(
      <span
        key={`slash-mention-${partIndex}`}
        className={`slash-mention slash-mention--${commandType}`}
        title={
          commandType === 'error'
            ? `Unknown command: ${commandText}`
            : undefined
        }
      >
        <span className="slash-mention-command">{commandText}</span>
        {name ? (
          <>
            {nameWhitespace}
            <span className="slash-mention-name">
              {name}
            </span>
          </>
        ) : null}
      </span>,
    );

    cursor = mentionEnd;
    partIndex += 1;
  }

  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }

  return (
    <span className={className} aria-hidden={className?.includes('highlight')}>
      {parts.length > 0 ? parts : content}
    </span>
  );
}
