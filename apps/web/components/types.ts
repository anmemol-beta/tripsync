export type MessageRole = 'me' | 'agent' | 'system';

export interface Message {
  role: MessageRole;
  author: string;
  body: string;
}

export interface TraceCall {
  name: string;
  args: Record<string, unknown>;
}

export interface TraceTurn {
  calls: TraceCall[];
  reply: string;
}

export interface ChatResponse {
  tool_calls?: TraceCall[];
  reply?: string;
}
