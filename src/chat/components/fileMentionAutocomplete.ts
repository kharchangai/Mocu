export type ActiveFileMention = {
  start: number;
  end: number;
  query: string;
};

/** Finds an @path token immediately before the caret, including quoted paths with spaces. */
export function findActiveFileMention(
  value: string,
  caretPosition: number,
): ActiveFileMention | null {
  const textBeforeCaret = value.slice(0, caretPosition);
  const marker = textBeforeCaret.lastIndexOf('@');

  if (marker < 0) {
    return null;
  }

  const hasOpeningQuote = textBeforeCaret[marker + 1] === '"';
  const tokenBeforeCaret = textBeforeCaret.slice(marker + 1);
  let closingQuoteIndex = -1;
  if (hasOpeningQuote) {
    let escaped = false;
    for (let index = 1; index < tokenBeforeCaret.length; index += 1) {
      const character = tokenBeforeCaret[index];
      if (character === '"' && !escaped) {
        closingQuoteIndex = index;
        break;
      }
      escaped = character === '\\' && !escaped;
      if (character !== '\\') {
        escaped = false;
      }
    }
    if (closingQuoteIndex >= 0 && closingQuoteIndex !== tokenBeforeCaret.length - 1) {
      return null;
    }
  } else if (/\s/.test(tokenBeforeCaret)) {
    return null;
  }

  const precedingCharacter = textBeforeCaret[marker - 1];
  if (precedingCharacter && !/[\s([{]/.test(precedingCharacter)) {
    return null;
  }

  const queryStart = marker + (hasOpeningQuote ? 2 : 1);
  let end = caretPosition;

  if (hasOpeningQuote) {
    let escaped = false;
    while (end < value.length) {
      const character = value[end];
      if (character === '"' && !escaped) {
        end += 1;
        break;
      }
      escaped = character === '\\' && !escaped;
      if (character !== '\\') {
        escaped = false;
      }
      end += 1;
    }
  } else {
    while (end < value.length && !/\s/.test(value[end])) {
      end += 1;
    }
  }

  let query = textBeforeCaret.slice(queryStart);
  if (closingQuoteIndex === tokenBeforeCaret.length - 1) {
    query = query.slice(0, -1);
  }
  query = query.replace(/\\"/g, '"');

  return { start: marker, end, query };
}

export type SearchableFileEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
};

export type RecursiveFileMatch = {
  name: string;
  relativePath: string;
  isDirectory: boolean;
};

const IGNORED_SEARCH_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.next',
  '.turbo',
  '.venv',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'vendor',
  'venv',
]);

/** Searches nested project folders for names matching a typed @query. */
export async function searchProjectFilesRecursively(
  readDirectory: (relativeDirectory: string) => Promise<SearchableFileEntry[]>,
  query: string,
  baseDirectory = '',
  shouldStop: () => boolean = () => false,
  options: { maxDirectories?: number; maxDepth?: number; maxMatches?: number } = {},
): Promise<RecursiveFileMatch[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  const maxDirectories = options.maxDirectories ?? 2500;
  const maxDepth = options.maxDepth ?? 12;
  const maxMatches = options.maxMatches ?? 1500;
  const matches: RecursiveFileMatch[] = [];
  let visitedDirectories = 0;
  const baseDepth = baseDirectory.split('/').filter(Boolean).length;

  const visit = async (relativeDirectory: string): Promise<void> => {
    if (
      shouldStop() ||
      visitedDirectories >= maxDirectories ||
      relativeDirectory.split('/').filter(Boolean).length - baseDepth > maxDepth
    ) {
      return;
    }

    visitedDirectories += 1;
    let entries: SearchableFileEntry[];
    try {
      entries = await readDirectory(relativeDirectory);
    } catch (error) {
      if (relativeDirectory === baseDirectory) {
        throw error;
      }
      return;
    }

    for (const entry of entries) {
      if (shouldStop()) {
        return;
      }

      if (!entry.isDirectory && !entry.isFile) {
        continue;
      }

      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
        matches.push({
          name: entry.name,
          relativePath,
          isDirectory: entry.isDirectory,
        });
      }

      if (
        entry.isDirectory &&
        !IGNORED_SEARCH_DIRECTORIES.has(entry.name.toLocaleLowerCase())
      ) {
        await visit(relativePath);
      }

      if (matches.length >= maxMatches) {
        return;
      }
    }
  };

  await visit(baseDirectory);

  return matches
    .sort((first, second) => {
      const firstName = first.name.toLocaleLowerCase();
      const secondName = second.name.toLocaleLowerCase();
      const firstScore = firstName === normalizedQuery ? 0 : firstName.startsWith(normalizedQuery) ? 1 : 2;
      const secondScore = secondName === normalizedQuery ? 0 : secondName.startsWith(normalizedQuery) ? 1 : 2;
      return firstScore - secondScore ||
        Number(second.isDirectory) - Number(first.isDirectory) ||
        first.relativePath.localeCompare(second.relativePath, undefined, { numeric: true, sensitivity: 'base' });
    })
    .slice(0, 100);
}

/** Splits a typed relative path into the directory to browse and its filename query. */
export function splitFileMentionPath(query: string): {
  directoryPath: string;
  nameQuery: string;
} {
  const normalized = query.replace(/\\/g, '/');
  const hasTrailingSeparator = normalized.endsWith('/');
  const parts: string[] = [];
  for (const part of normalized.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  if (hasTrailingSeparator) {
    return { directoryPath: parts.join('/'), nameQuery: '' };
  }

  const nameQuery = parts.pop() ?? '';
  return { directoryPath: parts.join('/'), nameQuery };
}
