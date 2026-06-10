import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  COLLECTIONS,
  type HistoryDoc,
  type MemberDoc,
  type MessageDoc,
  type ProposalDoc,
  type TripMemoryDoc,
  type TripDoc,
  type VideoJobDoc,
  type VoteDoc,
} from "@tripsync/schema";
import {
  appendVote,
  runTurn,
  type GeminiClient,
  type MongoMcpClient,
  type VertexEmbeddingClient,
} from "@tripsync/agent";

export type AppDeps = {
  db: Db;
  gemini: GeminiClient;
  mcp?: MongoMcpClient;
  mcpDatabase?: string;
  embeddings?: VertexEmbeddingClient;
  vectorSearchIndex?: string;
};

const ChatBody = z.object({
  trip_id: z.string(),
  author: z.string(),
  text: z.string().min(1),
});

const VoteBody = z.object({
  proposal_id: z.string(),
  voter: z.string(),
  option_id: z.string(),
});

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/chat", async (c) => {
    const body = ChatBody.parse(await c.req.json());
    const trace = await runTurn({
      db: deps.db,
      gemini: deps.gemini,
      tripId: body.trip_id,
      author: body.author,
      userText: body.text,
      ctx: {
        ...(deps.mcp ? { mcp: deps.mcp, mcpDatabase: deps.mcpDatabase } : {}),
        ...(deps.embeddings
          ? {
              embedText: (text, taskType) => deps.embeddings!.embed(text, taskType),
              vectorSearchIndex: deps.vectorSearchIndex,
            }
          : {}),
      },
    });
    return c.json({
      reply: trace.reply,
      tool_calls: trace.calls.map((call) => ({ name: call.name, args: call.args })),
      tool_steps: trace.steps,
    });
  });

  app.post("/vote", async (c) => {
    const body = VoteBody.parse(await c.req.json());
    const result = await appendVote(
      {
        db: deps.db,
        now: () => new Date().toISOString(),
        ...(deps.mcp ? { mcp: deps.mcp, mcpDatabase: deps.mcpDatabase } : {}),
      },
      body,
    );
    return c.json(result);
  });

  app.get("/trip/:id", async (c) => {
    const id = c.req.param("id");
    const doc = await deps.db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: id });
    if (!doc) return c.json({ error: "not_found" }, 404);
    return c.json(doc);
  });

  app.get("/trip/:id/state", async (c) => {
    const tripId = c.req.param("id");
    const trip = await deps.db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: tripId });
    if (!trip) return c.json({ error: "not_found" }, 404);

    const [members, messages, proposals, votes, history, videoJobs, tripMemories] =
      await Promise.all([
        deps.db
          .collection<MemberDoc>(COLLECTIONS.members)
          .find({ trip_id: tripId })
          .sort({ _id: 1 })
          .toArray(),
        deps.db
          .collection<MessageDoc>(COLLECTIONS.messages)
          .find({ trip_id: tripId })
          .sort({ created_at: 1 })
          .toArray(),
        deps.db
          .collection<ProposalDoc>(COLLECTIONS.proposals)
          .find({ trip_id: tripId })
          .sort({ created_at: -1 })
          .toArray(),
        deps.db.collection<VoteDoc>(COLLECTIONS.votes).find({}).toArray(),
        deps.db
          .collection<HistoryDoc>(COLLECTIONS.history)
          .find({ trip_id: tripId })
          .sort({ created_at: -1 })
          .limit(20)
          .toArray(),
        deps.db
          .collection<VideoJobDoc>(COLLECTIONS.videoJobs)
          .find({ trip_id: tripId })
          .sort({ created_at: -1 })
          .limit(5)
          .toArray(),
        deps.db
          .collection<TripMemoryDoc>(COLLECTIONS.tripMemories)
          .find({ trip_id: tripId }, { projection: { embedding: 0 } })
          .sort({ rating: -1, created_at: -1 })
          .limit(8)
          .toArray(),
      ]);

    return c.json({
      trip,
      members,
      messages,
      proposals,
      votes,
      history,
      video_jobs: videoJobs,
      trip_memories: tripMemories,
    });
  });

  return app;
}
