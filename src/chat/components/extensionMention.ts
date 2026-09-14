import type {
  AvailableExtension,
} from './extensionTypes';

/*
 * Filters installed extensions by name, id, or description against the
 * query text after "/extension ".
 */
export function filterExtensions(
  extensions: AvailableExtension[],
  query: string,
): AvailableExtension[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return extensions;
  }

  return extensions.filter((extension) => {
    const nameMatch =
      extension.name.toLowerCase().includes(normalizedQuery);

    const idMatch =
      extension.id.toLowerCase().includes(normalizedQuery);

    const description = (extension.description ?? '').trim();
    const descriptionMatch =
      description.length > 0 &&
      description.toLowerCase().includes(normalizedQuery);

    return nameMatch || idMatch || descriptionMatch;
  });
}
