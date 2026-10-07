import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ChatMessageList,
  ChatMessageListHeader,
  ChatMessageListFooter,
} from './ChatMessageList';

// Virtuoso changes these offsets as rows are mounted/unmounted. The list must
// leave them untouched; visual spacing belongs to its measured Header/Footer.
describe('virtualized chat message layout', () => {
  it('preserves virtual item offsets and list attributes', () => {
    const html = renderToStaticMarkup(createElement(ChatMessageList, {
      'data-testid': 'virtuoso-item-list',
      style: { paddingTop: 240, paddingBottom: 480, marginTop: 0 },
      children: createElement('div', null, 'message'),
    }));
    expect(html).toContain('class="chat-box-messages-inner"');
    expect(html).toContain('data-testid="virtuoso-item-list"');
    expect(html).toContain('padding-top:240px');
    expect(html).toContain('padding-bottom:480px');
    expect(html).toContain('>message</div>');
  });

  it('provides separate measured top and bottom spacers', () => {
    const header = renderToStaticMarkup(createElement(ChatMessageListHeader));
    const footer = renderToStaticMarkup(createElement(ChatMessageListFooter));
    expect(header).toContain('chat-box-messages-spacer--top');
    expect(footer).toContain('chat-box-messages-spacer--bottom');
    expect(header).toContain('aria-hidden="true"');
    expect(footer).toContain('aria-hidden="true"');
  });
});
