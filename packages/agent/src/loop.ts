import type { Db } from "mongodb";
import { COLLECTIONS, type MessageDoc } from "@tripsync/schema";
import type { FunctionCall, GeminiClient, Turn } from "./gemini.js";
import { TOOLS, type ToolContext } from "./runtime.js";
import { TOOL_NAMES, TOOL_SCHEMAS, type ToolName } from "./tools.js";

export const SYSTEM_PROMPT = `You are Tripsync, an agent helping 2-5 friends plan one trip together.
Your memory is MongoDB. Use the listed tools to read and write trip state.
Never decide for the group without a vote. Always append_history after state-changing tool calls.
When the user asks for recommendations, preferences, quiet/crowded fit, or video direction, call search_semantic_memories before proposing so past high-rated memories influence the answer.
The final product moment is a vertical travel recap video. When the group asks for a recap, use create_travel_video to persist a concrete video brief with scenes.
Reply in Korean with structured, phone-friendly formatting.
Do not write long prose paragraphs.
Use this shape:
[short title]
- key result
- evidence from memory/tools
- next action
For recommendations, use 2-4 numbered cards:
1. Place or option
   - why it fits
   - video angle or decision reason
For video briefs, use:
Video brief saved
- concept
- scenes
- MongoDB status`;

export type AgentTrace = {
  calls: FunctionCall[];
  steps: Array<{ name: string; status: "completed" | "failed"; summary: string }>;
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
  const trace: AgentTrace = { calls: [], steps: [], reply: "" };

  for (let hop = 0; hop < maxToolHops; hop++) {
    const out = await gemini.generate({
      system: `${SYSTEM_PROMPT}\nCurrent trip_id: ${tripId}\nCurrent author: ${author}`,
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
        trace.steps.push({
          name: call.name,
          status: "completed",
          summary: summarizeToolResult(call.name, result),
        });
        responses.push({ id: call.id, name: call.name, result });
      } catch (err) {
        trace.steps.push({
          name: call.name,
          status: "failed",
          summary: (err as Error).message,
        });
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

function summarizeToolResult(name: ToolName, result: unknown): string {
  if (name === "search_semantic_memories" && Array.isArray(result)) {
    return `${result.length} rated memories retrieved`;
  }
  if (name === "find_trip") return "trip loaded from MongoDB";
  if (name === "list_members" && Array.isArray(result)) return `${result.length} members loaded`;
  if (name === "insert_proposal" && result && typeof result === "object") {
    const id = (result as { proposal_id?: unknown }).proposal_id;
    return id ? `proposal ${String(id)} stored` : "proposal stored";
  }
  if (name === "append_vote") return "vote persisted";
  if (name === "tally_votes" && result && typeof result === "object") {
    const winner = (result as { winner_option_id?: unknown }).winner_option_id;
    return winner ? `winner ${String(winner)} found` : "votes tallied";
  }
  if (name === "update_trip_decision") return "decision persisted";
  if (name === "append_history") return "history event appended";
  if (name === "create_travel_video" && result && typeof result === "object") {
    const id = (result as { video_job_id?: unknown }).video_job_id;
    return id ? `video job ${String(id)} created` : "video job created";
  }
  if (Array.isArray(result)) return `${result.length} results`;
  return "completed";
}
