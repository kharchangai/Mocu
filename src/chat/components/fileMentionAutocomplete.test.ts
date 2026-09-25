import { describe, expect, it } from 'vitest';
import {
  findActiveFileMention,
  searchProjectFilesRecursively,
  splitFileMentionPath,
  type SearchableFileEntry,
} from './fileMentionAutocomplete';

describe('findActiveFileMention', () => {
  it('finds a path token at the caret', () => {
    const value = 'Read @src/components/App';
    expect(findActiveFileMention(value, value.length)).toEqual({
      start: 5,
      end: value.length,
      query: 'src/components/App',
    });
  });

  it('supports quoted paths containing spaces', () => {
    expect(findActiveFileMention('Read @"src/my file', 18)).toEqual({
      start: 5,
      end: 18,
      query: 'src/my file',
    });
  });

  it('does not reopen after a completed quoted mention and following text', () => {
    const value = 'Read @"src/my file" now';
    expect(findActiveFileMention(value, value.length)).toBeNull();
  });

  it('does not treat an email address as a file mention', () => {
    expect(findActiveFileMention('name@example.com', 16)).toBeNull();
  });
});

describe('searchProjectFilesRecursively', () => {
  it('finds matching files in nested folders and returns project-relative paths', async () => {
    const tree: Record<string, SearchableFileEntry[]> = {
      '': [
        { name: 'src', isDirectory: true, isFile: false },
        { name: 'node_modules', isDirectory: true, isFile: false },
      ],
      src: [
        { name: 'components', isDirectory: true, isFile: false },
      ],
      'src/components': [
        { name: 'ChatInput.tsx', isDirectory: false, isFile: true },
      ],
      node_modules: [
        { name: 'ChatInput-copy.tsx', isDirectory: false, isFile: true },
      ],
    };

    const matches = await searchProjectFilesRecursively(
      async (directory) => tree[directory] ?? [],
      'chatinput',
    );

    expect(matches).toEqual([
      {
        name: 'ChatInput.tsx',
        relativePath: 'src/components/ChatInput.tsx',
        isDirectory: false,
      },
    ]);
  });

  it('searches under the currently browsed folder', async () => {
    const tree: Record<string, SearchableFileEntry[]> = {
      src: [{ name: 'components', isDirectory: true, isFile: false }],
      'src/components': [
        { name: 'ChatInput.tsx', isDirectory: false, isFile: true },
      ],
    };

    const matches = await searchProjectFilesRecursively(
      async (directory) => tree[directory] ?? [],
      'chat',
      'src',
    );

    expect(matches[0]?.relativePath).toBe('src/components/ChatInput.tsx');
  });
});

describe('splitFileMentionPath', () => {
  it('uses nested path segments to select the directory to search', () => {
    expect(splitFileMentionPath('src/components/App')).toEqual({
      directoryPath: 'src/components',
      nameQuery: 'App',
    });
  });

  it('lists the contents of a directory when the path ends in a separator', () => {
    expect(splitFileMentionPath('src/components/')).toEqual({
      directoryPath: 'src/components',
      nameQuery: '',
    });
  });

  it('normalizes Windows separators and prevents parent traversal', () => {
    expect(splitFileMentionPath('src\\..\\package')).toEqual({
      directoryPath: '',
      nameQuery: 'package',
    });
  });
});
