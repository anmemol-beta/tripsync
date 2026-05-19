'use client';

import { useState } from 'react';
import type { TraceTurn } from './types';

interface Props {
  turns: TraceTurn[];
}

export default function TracePanel({ turns }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderTop: '1px solid #eee', background: '#fff', fontSize: '12px' }}>
      <button
        style={{
          width: '100%',
          padding: '8px 16px',
          textAlign: 'left',
          background: 'none',
          border: 'none',
          fontSize: '12px',
          color: '#555',
          cursor: 'pointer',
        }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▼' : '▶'} agent tool trace ({turns.length} turns)
      </button>
      {open && (
        <div style={{ padding: '0 16px 12px', overflowX: 'auto' }}>
          {turns.length === 0 ? (
            <p style={{ color: '#aaa', margin: '4px 0' }}>no traces yet</p>
          ) : (
            turns.map((t, i) => (
              <details key={i} style={{ marginBottom: '10px' }}>
                <summary style={{ fontWeight: 600, color: '#333', cursor: 'pointer', padding: '2px 0' }}>
                  Turn {i + 1} — {t.calls.map((c) => c.name).join(' → ')}
                </summary>
                <ol style={{ margin: '4px 0 0 0', paddingLeft: '20px', color: '#555' }}>
                  {t.calls.map((c, j) => (
                    <li key={j} style={{ margin: '2px 0', fontFamily: 'monospace', fontSize: '11px' }}>
                      {c.name}({JSON.stringify(c.args).slice(0, 60)}…)
                    </li>
                  ))}
                </ol>
                <div style={{ color: '#777', padding: '4px 0' }}>{t.reply}</div>
              </details>
            ))
          )}
        </div>
      )}
    </div>
  );
}
