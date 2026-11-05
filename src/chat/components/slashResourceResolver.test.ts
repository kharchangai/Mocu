import { describe, expect, it } from 'vitest';
import { resolveSlashMentions } from './slashResourceResolver';

type Resource = { id: string; name: string };
const resources: Resource[] = [
  { id: 'computer-use', name: 'Computer Use' },
  { id: 'browser', name: 'Browser' },
];
const aliases = (resource: Resource) => [resource.name, resource.id];

describe('resolveSlashMentions', () => {
  it('resolves a pasted agent reference in surrounding text', () => {
    expect(
      resolveSlashMentions('Please use /agent Computer Use to do this.', 'agent', resources, aliases),
    ).toEqual([resources[0]]);
  });

  it('resolves extension ids, is case-insensitive, and returns multiple mentions once', () => {
    expect(
      resolveSlashMentions(
        '/extension BROWSER, then /extension browser',
        'extension',
        resources,
        aliases,
      ),
    ).toEqual([resources[1]]);
  });

  it('prefers the longest resource name when names share a prefix', () => {
    const choices = [{ id: 'short', name: 'Code' }, { id: 'long', name: 'Code Reviewer' }];
    expect(
      resolveSlashMentions('/agent Code Reviewer please', 'agent', choices, (item) => [item.name]),
    ).toEqual([choices[1]]);
  });

  it('does not match partial names or unrelated slash commands', () => {
    expect(
      resolveSlashMentions('/agent Computer Users /skill Browser', 'agent', resources, aliases),
    ).toEqual([]);
  });
});
