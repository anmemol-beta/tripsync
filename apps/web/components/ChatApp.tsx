'use client';

import { useState, useRef } from 'react';
import MessageBubble from './MessageBubble';
import TracePanel from './TracePanel';
import ChatForm from './ChatForm';
import type { Message, TraceTurn, ChatResponse } from './types';

const TRIP_ID = 'trip_tokyo_2026_05';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const USERS = ['seo', 'jamie', 'min'] as const;
type User = (typeof USERS)[number];

export default function ChatApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [traces, setTraces] = useState<TraceTurn[]>([]);
  const [user, setUser] = useState<User>('seo');
  const threadRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }

  async function refreshTrace() {
    try {
      const r = await fetch(`${API_BASE}/trace/${TRIP_ID}`);
      const turns = (await r.json()) as TraceTurn[];
      setTraces(turns);
    } catch (_) {
      /* silently ignore trace refresh errors */
    }
  }

  async function handleSend(text: string) {
    setMessages((prev) => [...prev, { role: 'me', author: user, body: text }]);
    setTimeout(scrollToBottom, 0);
    try {
      const r = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trip_id: TRIP_ID, author: user, text }),
      });
      const j = (await r.json()) as ChatResponse;
      const toolCalls = j.tool_calls;
      if (toolCalls?.length) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            author: 'system',
            body: 'agent tools: ' + toolCalls.map((c) => c.name).join(' → '),
          },
        ]);
      }
      const reply = j.reply;
      if (reply) {
        setMessages((prev) => [...prev, { role: 'agent', author: 'agent', body: reply }]);
      }
      await refreshTrace();
      setTimeout(scrollToBottom, 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      setMessages((prev) => [
        ...prev,
        { role: 'system', author: 'system', body: `request failed: ${message}` },
      ]);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Tripsync — Boston Crew, Tokyo 5/26-5/30</h1>
        <p>
          Agent: planning.{' '}
          <label>
            You:{' '}
            <select value={user} onChange={(e) => setUser(e.target.value as User)}>
              {USERS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
        </p>
      </header>
      <div id="thread" ref={threadRef}>
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
      </div>
      <ChatForm onSend={handleSend} />
      <TracePanel turns={traces} />
    </div>
  );
}
