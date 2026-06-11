import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "mongodb";
import { z } from "zod";
import {
  COLLECTIONS,
  type EventDoc,
  type ExpenseDoc,
  type HistoryDoc,
  type MediaAssetDoc,
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
  duration_seconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).optional(),
  include: z.object({
    scenes: z.array(z.string()).optional(),
    photos: z.array(z.string()).optional(),
    events: z.array(z.string()).optional(),
    tickets: z.array(z.string()).optional(),
    settlement: z.boolean().optional(),
  }).optional(),
}).optional();

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS_DIR = path.join(API_ROOT, "assets");
const SOUNDTRACK_PATH = path.join(ASSETS_DIR, "tripsync-music.mp3");
const UPLOAD_DIR = path.join(API_ROOT, "uploads");
const execFileAsync = promisify(execFile);

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("*", cors());

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/assets/tripsync-music.mp3", async () => {
    return serveFile(SOUNDTRACK_PATH, "audio/mpeg", "public, max-age=31536000, immutable");
  });

  app.get("/assets/music/:file", async (c) => {
    const fileName = path.basename(c.req.param("file"));
    const filePath = path.join(ASSETS_DIR, "music", fileName);
    return serveFile(filePath, mediaContentType(fileName), "public, max-age=31536000, immutable");
  });

  app.get("/assets/demo/:kind/:file", async (c) => {
    const kind = path.basename(c.req.param("kind"));
    const fileName = path.basename(c.req.param("file"));
    const filePath = path.join(ASSETS_DIR, "demo", kind, fileName);
    return serveFile(filePath, mediaContentType(fileName), "public, max-age=31536000, immutable");
  });

  app.get("/uploads/:file", async (c) => {
    const fileName = path.basename(c.req.param("file"));
    const filePath = path.join(UPLOAD_DIR, fileName);
    try {
      const [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
      const contentType = mediaContentType(fileName);
      return serveBytes(c.req.header("range"), { bytes, byteLength: fileStat.size }, contentType);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  app.post("/trip/:id/media", async (c) => {
    const tripId = c.req.param("id");
    const form = await c.req.formData();
    const file = form.get("file");
    const author = String(form.get("author") ?? "");
    const caption = String(form.get("caption") ?? "").trim();
    if (!(file instanceof File)) return c.json({ error: "file_required" }, 400);
    if (!author) return c.json({ error: "author_required" }, 400);
    if (!file.type.startsWith("video/")) return c.json({ error: "video_required" }, 400);

    const trip = await deps.db.collection<TripDoc>(COLLECTIONS.trips).findOne({ _id: tripId });
    if (!trip) return c.json({ error: "not_found" }, 404);

    await mkdir(UPLOAD_DIR, { recursive: true });
    const now = new Date().toISOString();
    const id = `media_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const extension = extensionForVideo(file.name, file.type);
    const storedName = `${id}${extension}`;
    const filePath = path.join(UPLOAD_DIR, storedName);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const duration = await probeDuration(filePath);
    const trim = autoTrim(duration);
    const publicBaseUrl = deps.publicBaseUrl ?? "http://localhost:4000";
    const doc: MediaAssetDoc = {
      _id: id,
      trip_id: tripId,
      member_handle: author,
      kind: "video",
      original_name: file.name || storedName,
      mime_type: file.type || mediaContentType(storedName),
      file_url: `${publicBaseUrl.replace(/\/+$/, "")}/uploads/${storedName}`,
      file_path: filePath,
      duration_seconds: duration,
      trim_start_seconds: trim.start,
      trim_duration_seconds: trim.duration,
      caption: caption || null,
      status: "ready",
      created_at: now,
      updated_at: now,
    };

    await deps.db.collection<MediaAssetDoc>(COLLECTIONS.mediaAssets).insertOne(doc);
    await deps.db.collection<MessageDoc>(COLLECTIONS.messages).insertMany([
      {
        _id: `msg_${id}`,
        trip_id: tripId,
        author,
        body: `Uploaded video: ${doc.original_name}\n1. Auto trim starts at ${formatSeconds(doc.trim_start_seconds)}\n2. Clip length ${formatSeconds(doc.trim_duration_seconds)}\n3. Added to the next recap render`,
        created_at: now,
      },
      {
        _id: `msg_${id}_agent`,
        trip_id: tripId,
        author: "agent",
        body: `Video clip ready\n1. Source saved to trip media\n2. Best ${formatSeconds(doc.trim_duration_seconds)} section selected\n3. It will be mixed with photos, tickets, plans, split, and music`,
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ]);

    return c.json({ media_asset: doc });
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
      if (body?.duration_seconds) {
        await deps.db
          .collection<VideoJobDoc>(COLLECTIONS.videoJobs)
          .updateOne(
            { _id: id },
            { $set: { duration_seconds: body.duration_seconds, updated_at: new Date().toISOString() } },
          );
      }
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
      mediaAssets,
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
          .collection<MediaAssetDoc>(COLLECTIONS.mediaAssets)
          .find({ trip_id: tripId })
          .sort({ created_at: -1 })
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
      media_assets: mediaAssets,
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
  return serveBytes(range, video, contentType);
}

function serveBytes(
  range: string | undefined,
  video: { bytes: Buffer; byteLength: number },
  contentType: string,
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

async function serveFile(filePath: string, contentType: string, cacheControl: string): Promise<Response> {
  try {
    const [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
    return new Response(bytes, {
      headers: {
        "content-type": contentType,
        "content-length": String(fileStat.size),
        "cache-control": cacheControl,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
}

async function probeDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 20_000, maxBuffer: 1024 * 1024 },
    );
    const duration = Number(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
}

function autoTrim(duration: number | null): { start: number; duration: number } {
  if (!duration || duration <= 8) return { start: 0, duration: Math.max(duration ?? 6, 1) };
  const clipDuration = Math.min(8, duration);
  const start = duration > 18 ? Math.max(0, Math.round(duration * 0.2)) : 0;
  return { start, duration: Math.min(clipDuration, Math.max(duration - start, 1)) };
}

function extensionForVideo(name: string, type: string): string {
  const ext = path.extname(name).toLowerCase();
  if ([".mp4", ".mov", ".webm", ".m4v"].includes(ext)) return ext;
  if (type === "video/webm") return ".webm";
  if (type === "video/quicktime") return ".mov";
  return ".mp4";
}

function mediaContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".flac") return "audio/flac";
  return "video/mp4";
}

function formatSeconds(value: number): string {
  return `${Number(value.toFixed(1))}s`;
}
