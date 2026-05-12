import type { Db } from "mongodb";
import { COLLECTIONS, type MessageDoc } from "@tripsync/schema";
import type { FunctionCall, GeminiClient, Turn } from "./gemini.js";
import { TOOLS, type ToolContext } from "./runtime.js";
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from "./tools.js";

export const SYSTEM_PROMPT = `You are Tripsync, an agent helping 2-5 friends plan one trip together.
Your memory is MongoDB. Use the listed tools to read and write trip state.
Never decide for the group without a vote. Always append_history after state-changing tool calls.
Reply in Korean, one short paragraph or a numbered options list.`;

export type AgentTrace = {
  calls: FunctionCall[];
  reply: string;
};

export type RunTurnArgs = {
  db: Db;
  gemini: GeminiClient;
  tripId: string;
  author: string;
  userText: string;
  ctx?: Partial<ToolContext>;
  maxToolHops?: number;
};

const isToolName = (n: string): n is ToolName =>
  (TOOL_NAMES as readonly string[]).includes(n);

const newMsgId = (): string =>
  `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export async function runTurn(args: RunTurnArgs): Promise<AgentTrace> {
  const { db, gemini, tripId, author, userText, ctx: ctxOverride, maxToolHops = 8 } = args;
  const now = ctxOverride?.now ?? (() => new Date().toISOString());
  const toolCtx: ToolContext = { db, now, ...ctxOverride };

  const userMsg: MessageDoc = {
    _id: newMsgId(),
    trip_id: tripId,
    author,
    body: userText,
    created_at: now(),
  };
  await db.collection<MessageDoc>(COLLECTIONS.messages).insertOne(userMsg);

  const history: Turn[] = [{ kind: "user", text: userText, author }];
  const trace: AgentTrace = { calls: [], reply: "" };

  for (let hop = 0; hop < maxToolHops; hop++) {
    const out = await gemini.generate({
      system: SYSTEM_PROMPT,
      history,
      toolNames: [...TOOL_NAMES],
    });

    if (out.kind === "text") {
      trace.reply = out.text;
      history.push({ kind: "model_text", text: out.text });
      const agentMsg: MessageDoc = {
        _id: newMsgId(),
        trip_id: tripId,
        author: "agent",
        body: out.text,
        created_at: now(),
      };
      await db.collection<MessageDoc>(COLLECTIONS.messages).insertOne(agentMsg);
      return trace;
    }

    history.push({ kind: "model_tool_calls", calls: out.calls });
    const responses = [];
    for (const call of out.calls) {
      trace.calls.push(call);
      if (!isToolName(call.name)) {
        responses.push({ id: call.id, name: call.name, result: { error: `unknown tool: ${call.name}` } });
        continue;
      }
      const schema = TOOL_SCHEMAS[call.name];
      const parsed = schema.safeParse(call.args);
      if (!parsed.success) {
        responses.push({
          id: call.id,
          name: call.name,
          result: { error: `invalid args: ${parsed.error.message}` },
        });
        continue;
      }
      try {
        const result = await TOOLS[call.name](toolCtx, parsed.data);
        responses.push({ id: call.id, name: call.name, result });
      } catch (err) {
        responses.push({
          id: call.id,
          name: call.name,
          result: { error: (err as Error).message },
        });
      }
    }
    history.push({ kind: "tool_responses", responses });
  }

  throw new Error(`agent loop exceeded ${maxToolHops} hops without a final text`);
}
