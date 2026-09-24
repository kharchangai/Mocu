export type SelectedFileReference = {
  mention: string;
  absolutePath: string;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Expands only file mentions selected from the picker, leaving composer text untouched. */
export function resolveFileMentions(
  text: string,
  references: SelectedFileReference[],
): string {
  return [...references]
    .sort((first, second) => second.mention.length - first.mention.length)
    .reduce((resolvedText, reference) => {
      const pattern = new RegExp(
        `(^|[\\s([{])${escapeRegExp(reference.mention)}(?=$|[\\s.,;:!?)}\\]])`,
        'g',
      );
      const inlinePath = reference.absolutePath.replace(/`/g, '\\`');

      return resolvedText.replace(pattern, (_match, prefix: string) =>
        `${prefix}\`${inlinePath}\``,
      );
    }, text);
}
