/**
 * Resolves explicit slash-resource references from message text. This runs at
 * send time (not only from composer keystrokes), so pasted references work too.
 */
export function resolveSlashMentions<T>(
  text: string,
  command: string,
  resources: readonly T[],
  getAliases: (resource: T) => readonly string[],
): T[] {
  const commandPattern = new RegExp(`(^|\\s)\\/${command}(?=\\s)`, 'gi');
  const candidates = resources
    .flatMap((resource) =>
      getAliases(resource)
        .map((alias) => alias.trim())
        .filter(Boolean)
        .map((alias) => ({ resource, alias, normalizedAlias: alias.toLocaleLowerCase() })),
    )
    .sort((first, second) => second.alias.length - first.alias.length);
  const resolved: T[] = [];
  const seen = new Set<T>();
  for (const commandMatch of text.matchAll(commandPattern)) {
    let resourceStart = (commandMatch.index ?? 0) + commandMatch[0].length;
    while (/\s/.test(text[resourceStart] ?? '')) resourceStart += 1;

    const remaining = text.slice(resourceStart).toLocaleLowerCase();
    const candidate = candidates.find(({ alias, normalizedAlias }) => {
      if (!remaining.startsWith(normalizedAlias)) return false;
      const nextCharacter = text[resourceStart + alias.length] ?? '';
      return !nextCharacter || /[\s,.;:!?)}\]]/.test(nextCharacter);
    });

    if (candidate && !seen.has(candidate.resource)) {
      seen.add(candidate.resource);
      resolved.push(candidate.resource);
    }
  }

  return resolved;
}
