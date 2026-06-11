import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  COLLECTIONS,
  type EventDoc,
  type ExpenseDoc,
  type HistoryDoc,
  type MemberDoc,
  type MessageDoc,
  type PhotoDoc,
  type ProposalDoc,
  type TicketDoc,
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
import {
  getVideoJobMp4,
  getVideoJobPreview,
  getVideoJobWebm,
  renderVideoJob,
  RenderHttpError,
} from "./videoRenderer.js";
import { summarizeSettlement } from "./settlement.js";

export type AppDeps = {
  db: Db;
  gemini: GeminiClient;
  mcp?: MongoMcpClient;
  mcpDatabase?: string;
  embeddings?: VertexEmbeddingClient;
  vectorSearchIndex?: string;
  publicBaseUrl?: string;
  videoRenderMode?: "mp4" | "html";
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

const RenderBody = z.object({
  include: z.object({
    scenes: z.array(z.string()).optional(),
    photos: z.array(z.string()).optional(),
    events: z.array(z.string()).optional(),
    tickets: z.array(z.string()).optional(),
    settlement: z.boolean().optional(),
  }).optional(),
}).optional();

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOUNDTRACK_PATH = path.join(API_ROOT, "assets/tripsync-music.mp3");

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/assets/tripsync-music.mp3", async () => {
    try {
      const [bytes, fileStat] = await Promise.all([readFile(SOUNDTRACK_PATH), stat(SOUNDTRACK_PATH)]);
      return new Response(bytes, {
        headers: {
          "content-type": "audio/mpeg",
          "content-length": String(fileStat.size),
          "cache-control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
  });

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

  app.post("/video-jobs/:id/render", async (c) => {
    const id = c.req.param("id");
    try {
      const body = RenderBody.parse(await c.req.json().catch(() => undefined));
      const result = await renderVideoJob(
        deps.db,
        id,
        {
          publicBaseUrl: deps.publicBaseUrl ?? "http://localhost:4000",
          mode: deps.videoRenderMode,
          include: body?.include,
        },
      );
      return c.json(result);
    } catch (err) {
      if (err instanceof RenderHttpError) {
        if (err.status === 404) return c.json({ error: err.message }, 404);
        if (err.status === 409) return c.json({ error: err.message }, 409);
        return c.json({ error: err.message }, 500);
      }
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "render_failed", message }, 500);
    }
  });

  app.get("/video-jobs/:id/preview", async (c) => {
    const id = c.req.param("id");
    const artifact = await getVideoJobPreview(deps.db, id);
    if (!artifact?.html) return c.json({ error: "not_found" }, 404);
    return c.html(artifact.html);
  });

  app.get("/video-jobs/:id/video.mp4", async (c) => {
    const id = c.req.param("id");
    const video = await getVideoJobMp4(deps.db, id);
    if (!video) return c.json({ error: "not_found" }, 404);
    return serveVideoBytes(c.req.header("range"), video, "video/mp4");
  });

  app.get("/video-jobs/:id/video.webm", async (c) => {
    const id = c.req.param("id");
    const video = await getVideoJobWebm(deps.db, id);
    if (!video) return c.json({ error: "not_found" }, 404);
    return serveVideoBytes(c.req.header("range"), video, "video/webm");
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

    const [
      members,
      messages,
      proposals,
      votes,
      history,
      events,
      tickets,
      expenses,
      photos,
      videoJobs,
      tripMemories,
    ] =
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
          .collection<EventDoc>(COLLECTIONS.events)
          .find({ trip_id: tripId })
          .sort({ starts_at: 1 })
          .toArray(),
        deps.db
          .collection<TicketDoc>(COLLECTIONS.tickets)
          .find({ trip_id: tripId })
          .sort({ starts_at: 1 })
          .toArray(),
        deps.db
          .collection<ExpenseDoc>(COLLECTIONS.expenses)
          .find({ trip_id: tripId })
          .sort({ created_at: -1 })
          .toArray(),
        deps.db
          .collection<PhotoDoc>(COLLECTIONS.photos)
          .find({ trip_id: tripId })
          .sort({ taken_at: 1 })
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
      events,
      tickets,
      expenses,
      photos,
      settlement: summarizeSettlement(expenses),
      video_jobs: videoJobs,
      trip_memories: tripMemories,
    });
  });

  return app;
}

function serveVideoBytes(
  range: string | undefined,
  video: { bytes: Buffer; byteLength: number },
  contentType: "video/mp4" | "video/webm",
): Response {
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    if (match) {
      const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
      const start = suffixLength ? Math.max(video.byteLength - suffixLength, 0) : Number(match[1] || 0);
      const end = match[1] && match[2] ? Number(match[2]) : video.byteLength - 1;
      const chunk = video.bytes.subarray(start, end + 1);
      return new Response(chunk, {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(chunk.length),
          "content-range": `bytes ${start}-${end}/${video.byteLength}`,
          "content-type": contentType,
          "cache-control": "no-store",
        },
      });
    }
  }
  return new Response(video.bytes, {
    headers: {
      "accept-ranges": "bytes",
      "content-type": contentType,
      "content-length": String(video.byteLength),
      "cache-control": "no-store",
    },
  });
}
