import type { ListProps } from 'react-virtuoso';

export function ChatMessageList({ children, style, ...props }: ListProps) {
  return (
    <div {...props} className="chat-box-messages-inner" style={style}>
      {children}
    </div>
  );
}

// Virtuoso measures these spacers as part of the scrollable content. Its List
// owns paddingTop/paddingBottom for offscreen rows, so CSS padding there is lost.
export function ChatMessageListHeader() {
  return <div className="chat-box-messages-spacer chat-box-messages-spacer--top" aria-hidden="true" />;
}

export function ChatMessageListFooter() {
  return <div className="chat-box-messages-spacer chat-box-messages-spacer--bottom" aria-hidden="true" />;
}
