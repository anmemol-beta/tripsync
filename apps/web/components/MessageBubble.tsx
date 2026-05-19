import type { Message } from './types';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const clsMap: Record<string, string> = {
    me: 'msg msg-me',
    agent: 'msg msg-agent',
    system: 'msg msg-system',
  };
  const cls = clsMap[message.role] ?? 'msg';

  if (message.role === 'system') {
    return <div className={cls}>{message.body}</div>;
  }

  return (
    <div className={cls}>
      <div className="author">{message.author}</div>
      <div>{message.body}</div>
    </div>
  );
}
