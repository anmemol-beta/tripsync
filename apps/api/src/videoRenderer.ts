import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type EventDoc,
  type ExpenseDoc,
  type HistoryDoc,
  type MediaAssetDoc,
  type MemberDoc,
  type MessageDoc,
  type TicketDoc,
  type TripDoc,
  type TripMemoryDoc,
  type VideoJobDoc,
} from "@tripsync/schema";

const ARTIFACTS_COLLECTION = "video_job_artifacts";
const VIDEO_OUTPUT_DIR = path.resolve(process.cwd(), ".generated-videos");
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MUSIC_DIR = path.join(API_ROOT, "assets/music");
const FALLBACK_SOUNDTRACK_PATH = path.join(API_ROOT, "assets/tripsync-music.mp3");
const FALLBACK_SOUNDTRACK_URL_PATH = "/assets/tripsync-music.mp3";
const execFileAsync = promisify(execFile);

type VideoJobArtifactDoc = {
  _id: string;
  video_job_id: string;
  trip_id: string;
  kind: "html_preview" | "mp4_video" | "webm_video";
  content_type: "text/html" | "video/mp4" | "video/webm";
  html?: string;
  file_path?: string;
  byte_length?: number;
  render_selection?: RenderOptions["include"];
  created_at: string;
  updated_at: string;
};

type PhotoLikeDoc = {
  _id?: string;
  id?: string;
  trip_id: string;
  url: string;
  caption?: string | null;
  place_name?: string | null;
  member_handle?: string | null;
  member_id?: string | null;
  taken_at?: string | number | null;
  status?: string | null;
  deleted_at?: string | number | null;
};

type RenderResult = {
  video_job_id: string;
  status: VideoJobDoc["status"];
  output_url: string | null;
};

type RenderMode = "mp4" | "html";

type RenderOptions = {
  publicBaseUrl: string;
  mode?: RenderMode;
  include?: {
    scenes?: string[];
    photos?: string[];
    events?: string[];
    tickets?: string[];
    settlement?: boolean;
  };
};

type RenderContext = {
  job: VideoJobDoc;
  trip: TripDoc;
  members: MemberDoc[];
  messages: MessageDoc[];
  history: HistoryDoc[];
  memories: Omit<TripMemoryDoc, "embedding">[];
  photos: PhotoLikeDoc[];
  events: EventDoc[];
  tickets: TicketDoc[];
  expenses: ExpenseDoc[];
  mediaAssets: MediaAssetDoc[];
  include?: RenderOptions["include"];
  selectedSceneIds: Set<string> | null;
  selectedPhotoIds: Set<string> | null;
  previewUrl: string;
  videoUrl: string;
  soundtrackPath: string;
  soundtrackUrl: string;
};

type SceneTiming = {
  index: number;
  start: number;
  duration: number;
  title: string;
};

type RenderInput =
  | { kind: "photo"; path: string; duration: number }
  | { kind: "card"; path: string; duration: number }
  | { kind: "video"; path: string; trimStart: number; duration: number };

const INTRO_DURATION_SECONDS = 2.6;
const OUTRO_DURATION_SECONDS = 3.2;

const FALLBACK_PHOTOS: Array<Pick<PhotoLikeDoc, "url" | "caption" | "place_name">> = [
  {
    url: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200",
    caption: "Tokyo street lights",
    place_name: "Shibuya",
  },
  {
    url: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1200",
    caption: "Quiet temple morning",
    place_name: "Tokyo",
  },
  {
    url: "https://images.unsplash.com/photo-1526481280693-3bfa7568e0f3?w=1200",
    caption: "Friends crossing the city",
    place_name: "Tokyo",
  },
  {
    url: "https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=1200",
    caption: "Night walk",
    place_name: "Shinjuku",
  },
];

export async function renderVideoJob(
  db: Db,
  jobId: string,
  options: RenderOptions,
): Promise<RenderResult> {
  const jobs = db.collection<VideoJobDoc>(COLLECTIONS.videoJobs);
  const now = new Date().toISOString();
  const job = await jobs.findOne({ _id: jobId });
  if (!job) throw new RenderHttpError(404, "video_job_not_found");

  if (!options.include && job.status === "ready" && job.output_url?.match(/\/video\.(mp4|webm)$/)) {
    return { video_job_id: job._id, status: job.status, output_url: job.output_url };
  }
  if (job.status === "rendering") {
    throw new RenderHttpError(409, "video_job_already_rendering");
  }

  await jobs.updateOne(
    { _id: jobId },
    {
      $set: {
        status: "rendering",
        failure_reason: null,
        updated_at: now,
      },
    },
  );

  try {
    const freshJob = await jobs.findOne({ _id: jobId });
    if (!freshJob) throw new Error("video job disappeared during render");

    const mode = options.mode ?? "mp4";
    const context = await loadRenderContext(db, freshJob, options.publicBaseUrl, mode, options.include);
    const html = buildRecapHtml(context);
    const artifact: VideoJobArtifactDoc = {
      _id: `artifact_${jobId}`,
      video_job_id: jobId,
      trip_id: freshJob.trip_id,
      kind: "html_preview",
      content_type: "text/html",
      html,
      render_selection: options.include,
      created_at: now,
      updated_at: new Date().toISOString(),
    };

    await db
      .collection<VideoJobArtifactDoc>(ARTIFACTS_COLLECTION)
      .updateOne(
        { _id: artifact._id },
        { $set: artifact },
        { upsert: true },
      );

    const outputUrl = mode === "mp4" ? await renderMp4Artifact(db, context, now) : context.previewUrl;
    const readyAt = new Date().toISOString();
    await jobs.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "ready",
          output_url: outputUrl,
          failure_reason: null,
          updated_at: readyAt,
        },
      },
    );

    return { video_job_id: jobId, status: "ready", output_url: outputUrl };
  } catch (err) {
    const reason = describeError(err).slice(0, 320);
    await jobs.updateOne(
      { _id: jobId },
      {
        $set: {
          status: "failed",
          failure_reason: reason,
          updated_at: new Date().toISOString(),
        },
      },
    );
    throw err;
  }
}

export async function getVideoJobPreview(
  db: Db,
  jobId: string,
): Promise<VideoJobArtifactDoc | null> {
  return db
    .collection<VideoJobArtifactDoc>(ARTIFACTS_COLLECTION)
    .findOne({ video_job_id: jobId, kind: "html_preview" });
}

export async function getVideoJobMp4(
  db: Db,
  jobId: string,
): Promise<{ bytes: Buffer; byteLength: number } | null> {
  const artifact = await db
    .collection<VideoJobArtifactDoc>(ARTIFACTS_COLLECTION)
    .findOne({ video_job_id: jobId, kind: "mp4_video" });
  if (!artifact?.file_path) return null;
  const [bytes, fileStat] = await Promise.all([readFile(artifact.file_path), stat(artifact.file_path)]);
  return { bytes, byteLength: artifact.byte_length ?? fileStat.size };
}

export async function getVideoJobWebm(
  db: Db,
  jobId: string,
): Promise<{ bytes: Buffer; byteLength: number } | null> {
  const artifact = await db
    .collection<VideoJobArtifactDoc>(ARTIFACTS_COLLECTION)
    .findOne({ video_job_id: jobId, kind: "webm_video" });
  if (!artifact?.file_path) return null;
  const [bytes, fileStat] = await Promise.all([readFile(artifact.file_path), stat(artifact.file_path)]);
  return { bytes, byteLength: artifact.byte_length ?? fileStat.size };
}

export class RenderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RenderHttpError";
  }
}

async function loadRenderContext(
  db: Db,
  job: VideoJobDoc,
  publicBaseUrl: string,
  mode: RenderMode,
  include: RenderOptions["include"] | undefined,
): Promise<RenderContext> {
  const trip = await db.collection<TripDoc>(COLLECTIONS.trips).findOne({ _id: job.trip_id });
  if (!trip) throw new Error(`trip not found: ${job.trip_id}`);

  const [members, messages, history, memories, photos, events, tickets, expenses, mediaAssets] = await Promise.all([
    db
      .collection<MemberDoc>(COLLECTIONS.members)
      .find({ trip_id: job.trip_id })
      .sort({ _id: 1 })
      .toArray(),
    db
      .collection<MessageDoc>(COLLECTIONS.messages)
      .find({ trip_id: job.trip_id })
      .sort({ created_at: 1 })
      .limit(12)
      .toArray(),
    db
      .collection<HistoryDoc>(COLLECTIONS.history)
      .find({ trip_id: job.trip_id })
      .sort({ created_at: -1 })
      .limit(8)
      .toArray(),
    db
      .collection<Omit<TripMemoryDoc, "embedding">>(COLLECTIONS.tripMemories)
      .find({ trip_id: job.trip_id }, { projection: { embedding: 0 } })
      .sort({ rating: -1, created_at: -1 })
      .limit(6)
      .toArray(),
    db
      .collection<PhotoLikeDoc>("photos")
      .find({ trip_id: job.trip_id, deleted_at: { $exists: false } })
      .sort({ taken_at: 1, _id: 1 })
      .limit(12)
      .toArray()
      .catch(() => []),
    db
      .collection<EventDoc>(COLLECTIONS.events)
      .find({ trip_id: job.trip_id })
      .sort({ starts_at: 1 })
      .toArray(),
    db
      .collection<TicketDoc>(COLLECTIONS.tickets)
      .find({ trip_id: job.trip_id })
      .sort({ starts_at: 1 })
      .toArray(),
    db
      .collection<ExpenseDoc>(COLLECTIONS.expenses)
      .find({ trip_id: job.trip_id, status: "parsed" })
      .sort({ created_at: -1 })
      .toArray(),
    db
      .collection<MediaAssetDoc>(COLLECTIONS.mediaAssets)
      .find({ trip_id: job.trip_id, kind: "video", status: "ready" })
      .sort({ created_at: 1, _id: 1 })
      .limit(12)
      .toArray()
      .catch(() => []),
  ]);

  const fallbackPhotos = FALLBACK_PHOTOS.map((photo, index) => ({
    ...photo,
    _id: `fallback_photo_${index + 1}`,
    trip_id: job.trip_id,
  }));

  const selectedPhotoIds = include?.photos?.length ? new Set(include.photos) : null;
  const selectedSceneIds = include?.scenes?.length ? new Set(include.scenes) : null;
  const sourcePhotos = photos.length ? photos : fallbackPhotos;
  const selectedPhotos = selectedPhotoIds
    ? sourcePhotos.filter((photo) => selectedPhotoIds.has(photo._id ?? ""))
    : sourcePhotos;
  const soundtrack = await chooseRandomSoundtrack(publicBaseUrl, job.duration_seconds);

  return {
    job,
    trip,
    members,
    messages,
    history,
    memories,
    photos: selectedPhotos.length ? selectedPhotos : sourcePhotos,
    events: include?.events?.length
      ? events.filter((event) => include.events!.includes(event._id))
      : events,
    tickets: include?.tickets?.length
      ? tickets.filter((ticket) => include.tickets!.includes(ticket._id))
      : tickets,
    expenses: include?.settlement === false ? [] : expenses,
    mediaAssets,
    include,
    selectedSceneIds,
    selectedPhotoIds,
    previewUrl: `${trimSlash(publicBaseUrl)}/video-jobs/${encodeURIComponent(job._id)}/preview`,
    videoUrl: `${trimSlash(publicBaseUrl)}/video-jobs/${encodeURIComponent(job._id)}/${mode === "mp4" ? "video.mp4" : "preview"}`,
    soundtrackPath: soundtrack.path,
    soundtrackUrl: soundtrack.url,
  };
}

async function renderMp4Artifact(db: Db, context: RenderContext, startedAt: string): Promise<string> {
  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
  const tempDir = await mkdtemp(path.join(tmpdir(), "tripsync-video-"));
  const outputPath = path.join(VIDEO_OUTPUT_DIR, `${context.job._id}.mp4`);

  try {
    const inputs = await prepareRenderInputs(context, tempDir);
    await runFfmpeg(inputs, context, outputPath, tempDir);
    const fileStat = await stat(outputPath);
    const artifact: VideoJobArtifactDoc = {
      _id: `artifact_mp4_${context.job._id}`,
      video_job_id: context.job._id,
      trip_id: context.job.trip_id,
      kind: "mp4_video",
      content_type: "video/mp4",
      file_path: outputPath,
      byte_length: fileStat.size,
      render_selection: context.include,
      created_at: startedAt,
      updated_at: new Date().toISOString(),
    };
    await db
      .collection<VideoJobArtifactDoc>(ARTIFACTS_COLLECTION)
      .updateOne({ _id: artifact._id }, { $set: artifact }, { upsert: true });
    return context.videoUrl;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function prepareRenderInputs(context: RenderContext, tempDir: string): Promise<RenderInput[]> {
  const duration = context.job.duration_seconds;
  const introPath = path.join(tempDir, "intro_card.ppm");
  const outroPath = path.join(tempDir, "outro_card.ppm");
  await Promise.all([
    writeFile(introPath, renderTitleCardPpm(context.job.title, context.trip.destination, `${duration}s travel recap`, "intro")),
    writeFile(outroPath, renderTitleCardPpm("More than a plan", context.job.title, "Trippo made the memory", "outro")),
  ]);

  const contentDuration = Math.max(1, duration - INTRO_DURATION_SECONDS - OUTRO_DURATION_SECONDS);
  const videoInputs: RenderInput[] = [];
  const targetPhotoCount = Math.min(context.photos.length, context.mediaAssets.length ? 4 : 6);
  const reservedPhotoDuration = targetPhotoCount > 0 ? Math.min(4, targetPhotoCount * 1.1) : 0;
  const videoTargetDuration = Math.max(0, contentDuration - reservedPhotoDuration);
  let videoDuration = 0;
  const orderedAssets = context.mediaAssets.length ? context.mediaAssets : [];
  const maxVideoPasses = orderedAssets.length * Math.ceil(duration / Math.max(1, orderedAssets.length * 6));
  for (let index = 0; index < maxVideoPasses && videoDuration < videoTargetDuration; index++) {
    const asset = orderedAssets[index % orderedAssets.length]!;
    if (videoDuration >= videoTargetDuration) break;
    try {
      await stat(asset.file_path);
    } catch {
      continue;
    }
    const remaining = videoTargetDuration - videoDuration;
    const clipDuration = Math.min(asset.trim_duration_seconds, remaining, 9);
    if (clipDuration <= 0.5) continue;
    videoInputs.push({
      kind: "video",
      path: asset.file_path,
      trimStart: asset.trim_start_seconds,
      duration: clipDuration,
    });
    videoDuration += clipDuration;
  }
  const photoInputs: RenderInput[] = [];
  const remainingPhotoTime = Math.max(0, contentDuration - videoDuration);
  const photoCount = Math.min(targetPhotoCount, Math.floor(remainingPhotoTime / 0.5));
  const photos = context.photos.slice(0, photoCount);
  const photoDuration = videoInputs.length
    ? Math.min(1.4, remainingPhotoTime / Math.max(photos.length, 1))
    : Math.max(3, remainingPhotoTime / Math.max(photos.length, 1));
  for (const [index, photo] of photos.entries()) {
    try {
      const res = await fetch(photo.url);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(tempDir, `photo_${index}.jpg`);
      await writeFile(filePath, bytes);
      photoInputs.push({ kind: "photo", path: filePath, duration: photoDuration });
    } catch {
      // Broken remote assets are skipped; the renderer only needs one usable photo.
    }
  }
  const inputs: RenderInput[] = [
    { kind: "card", path: introPath, duration: INTRO_DURATION_SECONDS },
    ...videoInputs,
    ...photoInputs,
    { kind: "card", path: outroPath, duration: OUTRO_DURATION_SECONDS },
  ];
  if (!inputs.length) {
    const fallbackPath = path.join(tempDir, "fallback.jpg");
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x243b37:s=1080x1920",
        "-frames:v",
        "1",
        fallbackPath,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    inputs.push({ kind: "photo", path: fallbackPath, duration });
  }
  return inputs;
}

async function runFfmpeg(
  inputs: RenderInput[],
  context: RenderContext,
  outputPath: string,
  tempDir: string,
): Promise<void> {
  const fps = 24;
  const duration = context.job.duration_seconds;
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const input of inputs) {
    if (input.kind === "photo" || input.kind === "card") {
      args.push("-loop", "1", "-framerate", String(fps), "-t", String(input.duration), "-i", input.path);
    } else {
      args.push("-ss", String(input.trimStart), "-t", String(input.duration), "-i", input.path);
    }
  }
  const popupOverlays = await createPopupOverlayImages(context, tempDir);
  for (const popup of popupOverlays) {
    args.push("-loop", "1", "-framerate", String(fps), "-t", String(duration), "-i", popup.path);
  }
  args.push("-i", context.soundtrackPath);

  const mediaFilters = inputs.map((input, index) => {
    if (input.kind === "photo") {
      const frames = Math.ceil(input.duration * fps);
      return `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='min(zoom+0.0018,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps},setsar=1,trim=duration=${input.duration},setpts=PTS-STARTPTS[v${index}]`;
    }
    if (input.kind === "card") {
      return `[${index}:v]scale=1080:1920,setsar=1,fps=${fps},trim=duration=${input.duration},setpts=PTS-STARTPTS[v${index}]`;
    }
    return `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=${fps},trim=duration=${input.duration},setpts=PTS-STARTPTS[v${index}]`;
  });
  const concatInputs = inputs.map((_, index) => `[v${index}]`).join("");
  const popupInputStart = inputs.length;
  const audioInputIndex = inputs.length + popupOverlays.length;
  const baseChain = [
    `${concatInputs}concat=n=${inputs.length}:v=1:a=0,trim=duration=${duration},format=yuv420p`,
    ...buildMotionEffectFilters(duration),
    `fade=t=in:st=0:d=0.7,fade=t=out:st=${Math.max(0, duration - 1.4).toFixed(2)}:d=1.4`,
    "drawbox=x=44:y=1510:w=992:h=24:color=black@0.38:t=fill",
  ].join(",");
  const overlayFilters: string[] = [`${baseChain}[base0]`];
  let current = "base0";
  popupOverlays.forEach((popup, index) => {
    const inputIndex = popupInputStart + index;
    const next = `base${index + 1}`;
    overlayFilters.push(
      `[${current}][${inputIndex}:v]overlay=x=62:y=${popup.y}:enable='between(t\\,${popup.start}\\,${popup.end})'[${next}]`,
    );
    current = next;
  });
  const filter = [
    ...mediaFilters,
    ...overlayFilters,
    `[${current}]format=yuv420p[v]`,
    `[${audioInputIndex}:a]aresample=async=1:first_pts=0,apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=0.16,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, duration - 3).toFixed(2)}:d=3[a]`,
  ].join(";");

  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  );

  await execFileAsync("ffmpeg", args, { timeout: 360_000, maxBuffer: 1024 * 1024 });
}

function buildMotionEffectFilters(duration: number): string[] {
  const latestEffectStart = Math.max(INTRO_DURATION_SECONDS + 2, duration - OUTRO_DURATION_SECONDS - 3);
  const zoomStarts = [8, 22, 36, 50, 66, 82, 98]
    .map((start) => INTRO_DURATION_SECONDS + start)
    .filter((start) => start < latestEffectStart);
  const glitchStarts = [14, 31, 47, 73, 91]
    .map((start) => INTRO_DURATION_SECONDS + start)
    .filter((start) => start < latestEffectStart);
  const zoomExpr = buildBetweenExpression(zoomStarts, 0.48);
  const glitchExpr = buildBetweenExpression(glitchStarts, 0.22);
  return [
    `scale=w='if(gte(${zoomExpr}\\,1)\\,1140\\,1080)':h='if(gte(${zoomExpr}\\,1)\\,2026\\,1920)':eval=frame`,
    "crop=1080:1920",
    "eq=contrast=1.05:saturation=1.12:gamma=1.01",
    "unsharp=5:5:0.45:3:3:0.15",
    `rgbashift=rh=10:bh=-10:edge=wrap:enable='${glitchExpr}'`,
    `noise=alls=14:allf=t+u:enable='${glitchExpr}'`,
  ];
}

function buildBetweenExpression(starts: number[], span: number): string {
  if (!starts.length) return "0";
  return starts
    .map((start) => `between(t\\,${start.toFixed(2)}\\,${(start + span).toFixed(2)})`)
    .join("+");
}

function buildRecapHtml(context: RenderContext): string {
  const visualTiles = context.mediaAssets.length
    ? context.mediaAssets.slice(0, 8).map((asset) => renderMediaAsset(asset))
    : context.photos.slice(0, 6).map((photo) => renderPhoto(photo));
  const includedScenes = getIncludedScenes(context);
  const sceneCards = includedScenes.slice(0, 5);
  const messageHighlights = context.messages.slice(-4);
  const memberDots = context.members.slice(0, 4);
  const memory = context.memories[0];
  const selectedFacts = buildSelectedFacts(context);
  const popups = buildViralPopups(context);
  const sceneTimeline = buildSceneTimeline(context.job, context.selectedSceneIds).slice(0, sceneCards.length);
  const sceneTimelineJson = serializeScriptJson(sceneTimeline);
  const popupsJson = serializeScriptJson(popups);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1080, height=1920, initial-scale=1" />
  <title>${escapeText(context.job.title)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1080px; height: 1920px; overflow: hidden; }
    body {
      background: #f6f1e8;
      color: #1d1b17;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .stage {
      position: relative;
      width: 1080px;
      height: 1920px;
      padding: 64px 72px;
      background:
        linear-gradient(180deg, rgba(246, 241, 232, 0.32), #f6f1e8 74%),
        radial-gradient(circle at 18% 18%, rgba(224, 120, 86, 0.22), transparent 28%),
        radial-gradient(circle at 82% 8%, rgba(47, 109, 100, 0.22), transparent 26%),
        #f6f1e8;
    }
    .label {
      margin: 0 0 18px;
      color: #2f6d64;
      font-size: 30px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    h1 {
      max-width: 880px;
      margin: 0;
      color: #1d1b17;
      font-size: 104px;
      line-height: 0.92;
      letter-spacing: 0;
    }
    .sub {
      max-width: 820px;
      margin: 28px 0 0;
      color: #4f4a42;
      font-size: 38px;
      line-height: 1.18;
    }
    .avatars {
      display: flex;
      margin-top: 30px;
    }
    .player {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 18px;
      align-items: center;
      margin-top: 32px;
      max-width: 850px;
      padding: 16px;
      border: 1px solid rgba(29, 27, 23, 0.14);
      border-radius: 8px;
      background: rgba(255, 253, 248, 0.82);
    }
    .audio-toggle {
      height: 64px;
      padding: 0 24px;
      border: 0;
      border-radius: 8px;
      background: #111318;
      color: #fffaf1;
      font-size: 24px;
      font-weight: 900;
    }
    .audio-state {
      color: #4f4a42;
      font-size: 22px;
      font-weight: 800;
    }
    .progress {
      grid-column: 1 / -1;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(29, 27, 23, 0.14);
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      background: #e07856;
      transition: width 120ms linear;
    }
    .avatar {
      display: grid;
      place-items: center;
      width: 72px;
      height: 72px;
      margin-right: -14px;
      border: 5px solid #f6f1e8;
      border-radius: 50%;
      color: #fff;
      font-size: 28px;
      font-weight: 900;
    }
    .photos {
      position: relative;
      height: 820px;
      margin-top: 36px;
      overflow: hidden;
      border-radius: 8px;
      background: #d9d2c5;
      box-shadow: 0 18px 45px rgba(28, 26, 22, 0.18);
    }
    .photos::before,
    .photos::after {
      position: absolute;
      left: 20px;
      right: 20px;
      z-index: 8;
      color: #fffaf1;
      text-shadow: 0 2px 14px rgba(0, 0, 0, 0.45);
      pointer-events: none;
    }
    .photos::before {
      content: "${escapeCssString(context.job.title)}";
      top: 88px;
      font-size: 58px;
      font-weight: 900;
      line-height: 0.95;
      animation: introTitle 5s ease-out forwards;
    }
    .photos::after {
      content: "saved to trippo";
      bottom: 86px;
      font-size: 30px;
      font-weight: 900;
      text-transform: uppercase;
      opacity: 0;
      animation: outroTitle ${context.job.duration_seconds}s linear infinite;
    }
    .photo {
      position: absolute;
      inset: 0;
      overflow: hidden;
      opacity: 0;
      transform: scale(1.02);
      transition: opacity 420ms linear;
    }
    .photo.is-visible { opacity: 1; z-index: 2; }
    .photo img,
    .photo video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scale(1.08) translate3d(0, 0, 0);
      animation: kenburns 7.2s ease-in-out infinite alternate;
    }
    .caption {
      position: absolute;
      left: 20px;
      right: 20px;
      bottom: 18px;
      padding: 14px 16px;
      border-radius: 8px;
      background: rgba(17, 19, 24, 0.72);
      color: #fffaf1;
      font-size: 24px;
      line-height: 1.15;
      transform: translateY(10px);
      animation: captionRise 1.2s ease-out infinite alternate;
    }
    .popup-layer {
      position: absolute;
      inset: 0;
      z-index: 12;
      pointer-events: none;
    }
    .popup {
      position: absolute;
      left: 76px;
      right: 76px;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 12px;
      align-items: start;
      max-width: 800px;
      border: 1px solid rgba(255, 255, 255, 0.5);
      border-radius: 28px;
      padding: 18px 20px;
      background: rgba(17, 19, 24, 0.82);
      color: #fffaf1;
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
      opacity: 0;
      transform: translateY(40px) scale(0.92);
      transition: opacity 180ms ease-out, transform 220ms cubic-bezier(.2, 1.4, .3, 1);
    }
    .popup.is-visible {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .popup:nth-child(2n) {
      left: 180px;
      right: 44px;
    }
    .popup-icon {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 16px;
      background: #e07856;
      color: #111318;
      font-size: 25px;
      font-weight: 900;
    }
    .popup strong {
      display: block;
      font-size: 25px;
      line-height: 1.08;
    }
    .popup span {
      display: block;
      margin-top: 5px;
      color: rgba(255, 250, 241, 0.82);
      font-size: 21px;
      line-height: 1.16;
    }
    .motion-label {
      position: absolute;
      top: 18px;
      left: 18px;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 10px;
      border-radius: 999px;
      padding: 10px 14px;
      background: rgba(17, 19, 24, 0.72);
      color: #fffaf1;
      font-size: 18px;
      font-weight: 900;
      text-transform: uppercase;
    }
    .motion-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #e07856;
      animation: pulse 0.9s ease-in-out infinite;
    }
    .scene-panel {
      position: absolute;
      left: 72px;
      right: 72px;
      bottom: 200px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .scene {
      min-height: 178px;
      padding: 22px;
      border: 1px solid rgba(29, 27, 23, 0.14);
      border-radius: 8px;
      background: rgba(255, 253, 248, 0.92);
      transition: background 180ms linear, border-color 180ms linear, transform 180ms linear;
    }
    .scene.is-active {
      border-color: #e07856;
      background: #fff6e8;
      transform: translateY(-10px);
    }
    .scene strong {
      display: block;
      font-size: 26px;
      line-height: 1.08;
    }
    .scene span {
      display: block;
      margin-top: 12px;
      color: #696154;
      font-size: 20px;
      line-height: 1.2;
    }
    .chat {
      position: absolute;
      left: 72px;
      right: 72px;
      bottom: 72px;
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 18px;
    }
    .bubble, .stat {
      border-radius: 8px;
      background: #111318;
      color: #fffaf1;
      padding: 20px 22px;
      font-size: 23px;
      line-height: 1.18;
    }
    .stat {
      background: #2f6d64;
      color: #f8fff9;
    }
    .bubble b {
      display: block;
      margin-bottom: 6px;
      color: #f1c0a8;
      font-size: 19px;
      text-transform: uppercase;
    }
    @keyframes kenburns {
      from { transform: scale(1.08) translate3d(-18px, -12px, 0); }
      to { transform: scale(1.18) translate3d(18px, 14px, 0); }
    }
    @keyframes captionRise {
      from { transform: translateY(10px); }
      to { transform: translateY(0); }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(0.72); opacity: 0.55; }
      50% { transform: scale(1.1); opacity: 1; }
    }
    @keyframes introTitle {
      0% { opacity: 0; transform: translateY(18px); }
      18%, 64% { opacity: 1; transform: translateY(0); }
      100% { opacity: 0; transform: translateY(-14px); }
    }
    @keyframes outroTitle {
      0%, 88% { opacity: 0; transform: translateY(16px); }
      94%, 100% { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body>
  <main class="stage" aria-label="Trippo vertical recap preview">
    <p class="label">Trippo recap preview</p>
    <h1>${escapeText(context.job.title)}</h1>
    <p class="sub">${escapeText(context.job.narrative || `${context.trip.destination} recap`)}</p>
    <div class="avatars" aria-label="Trip members">
      ${memberDots.map((member) => `<span class="avatar" style="background:${escapeAttr(member.avatar_color)}">${escapeText(member.display_name.slice(0, 1))}</span>`).join("")}
    </div>
    <section class="player" aria-label="Audio recap controls">
      <button class="audio-toggle" type="button" data-audio-start>Start recap with audio</button>
      <div class="audio-state" data-audio-state>Audio ready · tap to play synced recap</div>
      <div class="progress" aria-hidden="true"><div class="progress-fill" data-progress-fill></div></div>
    </section>

    <section class="photos" aria-label="Trip photos">
      <div class="motion-label"><span class="motion-dot"></span>playing real travel clips</div>
      ${visualTiles.map((tile, index) => tile.replace("class=\"photo\"", `class="photo${index === 0 ? " is-visible" : ""}"`)).join("")}
    </section>
    <section class="popup-layer" aria-label="Live recap callouts">
      ${popups.map((popup, index) => `
        <article class="popup" data-popup-index="${index}" style="top:${popup.top}px">
          <div class="popup-icon">${escapeText(popup.icon)}</div>
          <div>
            <strong>${escapeText(popup.title)}</strong>
            <span>${escapeText(popup.body)}</span>
          </div>
        </article>
      `).join("")}
    </section>

    <section class="scene-panel" aria-label="Video scenes">
      ${sceneCards.map((scene, index) => `
        <article class="scene" data-scene-index="${index}">
          <strong>${escapeText(scene.title)}</strong>
          <span>${escapeText(scene.prompt)} (${scene.duration_seconds}s)</span>
        </article>
      `).join("")}
    </section>

    <section class="chat" aria-label="Recap details">
      <article class="bubble">
        <b>${escapeText(messageHighlights.at(-1)?.author ?? "agent")}</b>
        ${escapeText(messageHighlights.at(-1)?.body ?? context.history[0]?.event_type ?? "Travel decisions saved in MongoDB.")}
      </article>
      <article class="stat">
        ${context.job.duration_seconds}s vertical render<br />
        ${context.mediaAssets.length} travel clips, ${context.photos.length} quick photo cuts<br />
        Music: ${escapeText(path.basename(context.soundtrackUrl))}${memory ? `<br />Top memory: ${escapeText(memory.title)}` : ""}<br />${escapeText(selectedFacts)}
      </article>
    </section>
  </main>
  <audio data-soundtrack src="${escapeAttr(context.soundtrackUrl)}" preload="auto" loop></audio>
  <script>
    const sceneTimeline = ${sceneTimelineJson};
    const popups = ${popupsJson};
    const recapDurationSeconds = ${context.job.duration_seconds};
    const startButton = document.querySelector("[data-audio-start]");
    const audioState = document.querySelector("[data-audio-state]");
    const progressFill = document.querySelector("[data-progress-fill]");
    const soundtrack = document.querySelector("[data-soundtrack]");
    const sceneEls = Array.from(document.querySelectorAll("[data-scene-index]"));
    const photoEls = Array.from(document.querySelectorAll(".photo"));
    const popupEls = Array.from(document.querySelectorAll("[data-popup-index]"));
    let startedAt = 0;
    let playing = false;
    let visualStartedAt = performance.now();

    startButton.addEventListener("click", async () => {
      if (playing) {
        stopRecap();
        return;
      }
      soundtrack.currentTime = 0;
      soundtrack.volume = 0.72;
      await soundtrack.play();
      startedAt = performance.now();
      playing = true;
      startButton.textContent = "Stop audio";
      audioState.textContent = "Audio playing · scenes synced to soundtrack";
    });

    window.requestAnimationFrame(tick);

    function stopRecap() {
      playing = false;
      soundtrack.pause();
      soundtrack.currentTime = 0;
      visualStartedAt = performance.now();
      startButton.textContent = "Start recap with audio";
      audioState.textContent = "Audio stopped · visual recap keeps playing";
    }

    function tick(now) {
      const elapsed = playing
        ? Math.max(0, (now - startedAt) / 1000)
        : ((now - visualStartedAt) / 1000) % recapDurationSeconds;
      setProgress(Math.min(elapsed / recapDurationSeconds, 1) * 100);
      const active = sceneTimeline.find((scene) => elapsed >= scene.start && elapsed < scene.start + scene.duration);
      setActiveScene(active ? active.index : -1);
      setActivePhoto(elapsed);
      setActivePopup(elapsed);
      if (playing && elapsed >= recapDurationSeconds) {
        stopRecap();
        audioState.textContent = "Audio complete · recap ended";
      }
      window.requestAnimationFrame(tick);
    }

    function setProgress(percent) {
      progressFill.style.width = percent.toFixed(2) + "%";
    }

    function setActiveScene(index) {
      for (const el of sceneEls) {
        el.classList.toggle("is-active", Number(el.dataset.sceneIndex) === index);
      }
    }

    function setActivePhoto(elapsed) {
      if (!photoEls.length) return;
      const index = Math.floor(elapsed / 4) % photoEls.length;
      for (const [photoIndex, el] of photoEls.entries()) {
        el.classList.toggle("is-visible", photoIndex === index);
      }
    }

    function setActivePopup(elapsed) {
      for (const [index, el] of popupEls.entries()) {
        const popup = popups[index];
        const visible = popup && elapsed >= popup.start && elapsed < popup.start + popup.duration;
        el.classList.toggle("is-visible", Boolean(visible));
      }
    }

  </script>
</body>
</html>`;
}

function buildViralPopups(context: RenderContext): Array<{ start: number; duration: number; top: number; icon: string; title: string; body: string }> {
  const offset = INTRO_DURATION_SECONDS;
  const friendMessages = context.messages.filter((item) => item.author !== "agent");
  const firstClip = context.mediaAssets[0];
  const middleClip = context.mediaAssets[Math.floor(context.mediaAssets.length / 2)];
  const lastClip = context.mediaAssets.at(-1);
  const photo = context.photos.find((item) => /food|lobster|stew|dinner/i.test(item.caption ?? item.place_name ?? "")) ?? context.photos[0];
  return [
    {
      start: offset + 2,
      duration: 4.2,
      top: 1160,
      icon: "CHAT",
      title: `${friendMessages[0]?.author ?? "seo"} said`,
      body: cleanPopupText(friendMessages[0]?.body ?? "Keep the road clip first."),
    },
    {
      start: offset + 8,
      duration: 4.2,
      top: 1010,
      icon: "ROAD",
      title: firstClip?.caption ?? "Road clip",
      body: "Open with movement so it feels like the trip is starting.",
    },
    {
      start: offset + 15,
      duration: 4.2,
      top: 1220,
      icon: "LOL",
      title: `${friendMessages[2]?.author ?? "min"} said`,
      body: cleanPopupText(friendMessages[2]?.body ?? "Use the clip where I look useful."),
    },
    {
      start: offset + 23,
      duration: 4.2,
      top: 1080,
      icon: "FOOD",
      title: photo?.place_name ?? "Food flash",
      body: "Quick food cuts on the beat, then back to the clips.",
    },
    {
      start: offset + 32,
      duration: 4.2,
      top: 1180,
      icon: "CLIP",
      title: middleClip?.caption ?? "Friend clip",
      body: "Small bubbles, no giant title over faces.",
    },
    {
      start: offset + 43,
      duration: 4.6,
      top: 1020,
      icon: "END",
      title: lastClip?.caption ?? "Walking close",
      body: `${context.mediaAssets.length} real clips + ${path.basename(context.soundtrackUrl)}`,
    },
  ];
}

async function createPopupOverlayImages(
  context: RenderContext,
  tempDir: string,
): Promise<Array<{ path: string; y: number; start: number; end: number }>> {
  const popups = buildViralPopups(context);
  const overlays: Array<{ path: string; y: number; start: number; end: number }> = [];
  for (const [index, popup] of popups.entries()) {
    const filePath = path.join(tempDir, `popup_${index}.ppm`);
    await writeFile(filePath, renderPopupPpm(popup.title, popup.body));
    overlays.push({
      path: filePath,
      y: 1080 + (index % 3) * 120,
      start: popup.start,
      end: popup.start + popup.duration,
    });
  }
  return overlays;
}

function cleanPopupText(value: string): string {
  return shorten(value.replace(/\n+/g, " ").replace(/\d+\.\s*/g, ""), 78);
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function renderPopupPpm(title: string, body: string): Buffer {
  const width = 956;
  const height = 112;
  const pixels = Buffer.alloc(width * height * 3);
  fillRect(pixels, width, 0, 0, width, height, [17, 19, 24]);
  fillRect(pixels, width, 0, 0, width, 4, [224, 120, 86]);
  drawBitmapText(pixels, width, 30, 22, cleanBitmapText(title).toUpperCase(), 4, [255, 255, 255], 29);
  drawBitmapText(pixels, width, 30, 68, cleanBitmapText(body).toUpperCase(), 3, [255, 241, 214], 43);
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, pixels]);
}

function renderTitleCardPpm(
  title: string,
  subtitle: string,
  footer: string,
  variant: "intro" | "outro",
): Buffer {
  const width = 1080;
  const height = 1920;
  const pixels = Buffer.alloc(width * height * 3);
  const background: [number, number, number] = variant === "intro" ? [246, 241, 232] : [17, 19, 24];
  const primary: [number, number, number] = variant === "intro" ? [17, 19, 24] : [255, 250, 241];
  const secondary: [number, number, number] = variant === "intro" ? [47, 109, 100] : [241, 192, 168];
  const accent: [number, number, number] = [224, 120, 86];
  fillRect(pixels, width, 0, 0, width, height, background);
  fillRect(pixels, width, 0, 0, width, 18, accent);
  fillRect(pixels, width, 92, 420, 896, 6, accent);
  fillRect(pixels, width, 92, 1450, 896, 6, secondary);
  drawCenteredBitmapText(pixels, width, 540, 540, variant === "intro" ? "TRIPPO RECAP" : "SAVED TO TRIPPO", 5, secondary, 26);
  drawTitleLines(pixels, width, 540, 690, title, primary);
  drawCenteredBitmapText(pixels, width, 540, 870, subtitle, 5, secondary, 24);
  drawCenteredBitmapText(pixels, width, 540, 1290, footer, 5, primary, 25);
  const header = Buffer.from(`P6\n${width} ${height}\n255\n`, "ascii");
  return Buffer.concat([header, pixels]);
}

function drawTitleLines(
  pixels: Buffer,
  width: number,
  centerX: number,
  y: number,
  title: string,
  color: [number, number, number],
): void {
  const words = cleanBitmapText(title).toUpperCase().split(/\s+/).filter(Boolean);
  const lines = splitBitmapLines(words, 13).slice(0, 2);
  const scale = lines.some((line) => line.length > 11) ? 7 : 8;
  const lineGap = 92;
  lines.forEach((line, index) => {
    drawCenteredBitmapText(pixels, width, centerX, y + index * lineGap, line, scale, color, 18);
  });
}

function splitBitmapLines(words: string[], maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : ["TRAVEL RECAP"];
}

function drawCenteredBitmapText(
  pixels: Buffer,
  width: number,
  centerX: number,
  y: number,
  text: string,
  scale: number,
  color: [number, number, number],
  maxChars: number,
): void {
  const cleaned = cleanBitmapText(text).toUpperCase().slice(0, maxChars);
  const textWidth = cleaned.length * 6 * scale;
  drawBitmapText(pixels, width, Math.max(20, Math.floor(centerX - textWidth / 2)), y, cleaned, scale, color, maxChars);
}

function fillRect(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      setPixel(pixels, width, xx, yy, color);
    }
  }
}

function drawBitmapText(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
  text: string,
  scale: number,
  color: [number, number, number],
  maxChars: number,
): void {
  let cursor = x;
  for (const char of text.slice(0, maxChars)) {
    const glyph = FONT_5X7[char] ?? SPACE_GLYPH;
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row]!.length; col++) {
        if (glyph[row]![col] !== "1") continue;
        fillRect(pixels, width, cursor + col * scale, y + row * scale, scale, scale, color);
      }
    }
    cursor += 6 * scale;
  }
}

function setPixel(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
  color: [number, number, number],
): void {
  const index = (y * width + x) * 3;
  if (index < 0 || index + 2 >= pixels.length) return;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
}

function cleanBitmapText(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^A-Za-z0-9 .,:/+&()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeInlineTransfer(expenses: ExpenseDoc[]): string {
  const totals = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.split_among.length === 0) continue;
    const share = Math.floor(expense.amount / expense.split_among.length);
    totals.set(expense.payer, (totals.get(expense.payer) ?? 0) + expense.amount);
    for (const member of expense.split_among) {
      totals.set(member, (totals.get(member) ?? 0) - share);
    }
  }
  const creditor = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const debtor = [...totals.entries()].sort((a, b) => a[1] - b[1])[0];
  if (!creditor || !debtor || creditor[1] <= 0 || debtor[1] >= 0) return "Everyone is settled.";
  return `${debtor[0]} pays ${creditor[0]} ${Math.min(creditor[1], -debtor[1]).toLocaleString()} KRW`;
}

const FONT_5X7: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "11100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

const SPACE_GLYPH = FONT_5X7[" "]!;

function buildSelectedFacts(context: RenderContext): string {
  const facts = [
    path.basename(context.soundtrackUrl),
    `${context.mediaAssets.length} clips`,
    context.photos[0]?.place_name,
  ].filter(Boolean);
  return facts.length ? `Travel mix: ${facts.join(" · ")}` : "Travel mix: video clips";
}

async function chooseRandomSoundtrack(
  publicBaseUrl: string,
  minDurationSeconds: number,
): Promise<{ path: string; url: string }> {
  try {
    const entries = await readdir(MUSIC_DIR);
    const candidates = entries
      .filter((entry) => /\.(mp3|m4a|wav|aac|flac)$/i.test(entry))
      .sort();
    const tracks: string[] = [];
    for (const entry of candidates) {
      const filePath = path.join(MUSIC_DIR, entry);
      const duration = await probeMediaDuration(filePath);
      if (duration === null || duration >= minDurationSeconds + 3) tracks.push(entry);
    }
    if (tracks.length) {
      const selected = tracks[Math.floor(Math.random() * tracks.length)]!;
      return {
        path: path.join(MUSIC_DIR, selected),
        url: `${trimSlash(publicBaseUrl)}/assets/music/${encodeURIComponent(selected)}`,
      };
    }
  } catch {
    // Fall through to the original single-track asset.
  }
  return {
    path: FALLBACK_SOUNDTRACK_PATH,
    url: `${trimSlash(publicBaseUrl)}${FALLBACK_SOUNDTRACK_URL_PATH}`,
  };
}

async function probeMediaDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function getIncludedScenes(context: RenderContext): VideoJobDoc["scenes"] {
  if (!context.selectedSceneIds) return context.job.scenes;
  const scenes = context.job.scenes.filter((scene) => context.selectedSceneIds!.has(scene.id));
  return scenes.length ? scenes : context.job.scenes;
}

function buildSceneTimeline(job: VideoJobDoc, selectedSceneIds: Set<string> | null = null): SceneTiming[] {
  const sourceScenes = selectedSceneIds
    ? job.scenes.filter((scene) => selectedSceneIds.has(scene.id))
    : job.scenes;
  const scenes = sourceScenes.length ? sourceScenes : [{
    id: "scene_1",
    title: job.title,
    source: "agent_memory" as const,
    prompt: job.narrative,
    duration_seconds: job.duration_seconds,
    asset_refs: [],
  }];
  const requestedTotal = scenes.reduce((sum, scene) => sum + scene.duration_seconds, 0);
  const scale = requestedTotal > 0 ? job.duration_seconds / requestedTotal : 1;
  let cursor = 0;
  return scenes.map((scene, index) => {
    const duration = Math.max(1, scene.duration_seconds * scale);
    const timing = {
      index,
      start: Number(cursor.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      title: scene.title,
    };
    cursor += duration;
    return timing;
  });
}

function renderMediaAsset(asset: MediaAssetDoc): string {
  const caption = asset.caption ?? asset.original_name;
  return `
    <figure class="photo">
      <video src="${escapeAttr(asset.file_url)}" muted autoplay loop playsinline preload="metadata"></video>
      <figcaption class="caption">${escapeText(caption)}</figcaption>
    </figure>`;
}

function renderPhoto(photo: PhotoLikeDoc): string {
  const caption = photo.caption ?? photo.place_name ?? "Trip moment";
  return `
    <figure class="photo">
      <img src="${escapeAttr(photo.url)}" alt="" />
      <figcaption class="caption">${escapeText(caption)}</figcaption>
    </figure>`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function escapeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeText(value);
}

function escapeCssString(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ");
}

function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const _internal = {
  ARTIFACTS_COLLECTION,
  buildRecapHtml,
};
