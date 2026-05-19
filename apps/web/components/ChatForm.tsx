'use client';

import { useState } from 'react';

interface Props {
  onSend: (text: string) => void;
}

export default function ChatForm({ onSend }: Props) {
  const [text, setText] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="say something..."
        autoComplete="off"
      />
      <button type="submit">send</button>
    </form>
  );
}
