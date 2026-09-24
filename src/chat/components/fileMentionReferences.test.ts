import { describe, expect, it } from 'vitest';
import { resolveFileMentions } from './fileMentionReferences';

describe('resolveFileMentions', () => {
  it('expands a selected @mention to its absolute path for the model', () => {
    expect(
      resolveFileMentions('Please inspect @src/main.ts first.', [
        { mention: '@src/main.ts', absolutePath: 'E:\\project\\src\\main.ts' },
      ]),
    ).toBe('Please inspect `E:\\project\\src\\main.ts` first.');
  });

  it('expands quoted mentions for file names with spaces', () => {
    expect(
      resolveFileMentions('Read @"src/my file.ts" please', [
        { mention: '@"src/my file.ts"', absolutePath: 'E:\\project\\src\\my file.ts' },
      ]),
    ).toBe('Read `E:\\project\\src\\my file.ts` please');
  });

  it('does not expand a mention that only shares a prefix', () => {
    expect(
      resolveFileMentions('@src/main.tsx and @src/main.ts', [
        { mention: '@src/main.ts', absolutePath: '/project/src/main.ts' },
      ]),
    ).toBe('@src/main.tsx and `/project/src/main.ts`');
  });

  it('expands the longer selected path before its selected parent folder', () => {
    expect(
      resolveFileMentions('@src/components/App.tsx and @src', [
        { mention: '@src', absolutePath: '/project/src' },
        { mention: '@src/components/App.tsx', absolutePath: '/project/src/components/App.tsx' },
      ]),
    ).toBe('`/project/src/components/App.tsx` and `/project/src`');
  });
});
