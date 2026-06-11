import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type HistoryDoc,
  type MemberDoc,
  type MessageDoc,
  type TripDoc,
  type TripMemoryDoc,
  type VideoJobDoc,
} from "@tripsync/schema";

const ARTIFACTS_COLLECTION = "video_job_artifacts";
const VIDEO_OUTPUT_DIR = path.resolve(process.cwd(), ".generated-videos");
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
};

type RenderContext = {
  job: VideoJobDoc;
  trip: TripDoc;
  members: MemberDoc[];
  messages: MessageDoc[];
  history: HistoryDoc[];
  memories: Omit<TripMemoryDoc, "embedding">[];
  photos: PhotoLikeDoc[];
  previewUrl: string;
  videoUrl: string;
};

type SceneTiming = {
  index: number;
  start: number;
  duration: number;
  title: string;
};

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

  if (job.status === "ready" && job.output_url?.endsWith("/video.webm")) {
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
    const context = await loadRenderContext(db, freshJob, options.publicBaseUrl, mode);
    const html = buildRecapHtml(context);
    const artifact: VideoJobArtifactDoc = {
      _id: `artifact_${jobId}`,
      video_job_id: jobId,
      trip_id: freshJob.trip_id,
      kind: "html_preview",
      content_type: "text/html",
      html,
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

    const outputUrl = mode === "mp4" ? await renderWebmArtifact(db, context, now) : context.previewUrl;
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
): Promise<RenderContext> {
  const trip = await db.collection<TripDoc>(COLLECTIONS.trips).findOne({ _id: job.trip_id });
  if (!trip) throw new Error(`trip not found: ${job.trip_id}`);

  const [members, messages, history, memories, photos] = await Promise.all([
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
  ]);

  const fallbackPhotos = FALLBACK_PHOTOS.map((photo, index) => ({
    ...photo,
    _id: `fallback_photo_${index + 1}`,
    trip_id: job.trip_id,
  }));

  return {
    job,
    trip,
    members,
    messages,
    history,
    memories,
    photos: photos.length ? photos : fallbackPhotos,
    previewUrl: `${trimSlash(publicBaseUrl)}/video-jobs/${encodeURIComponent(job._id)}/preview`,
    videoUrl: `${trimSlash(publicBaseUrl)}/video-jobs/${encodeURIComponent(job._id)}/${mode === "mp4" ? "video.webm" : "preview"}`,
  };
}

async function renderWebmArtifact(db: Db, context: RenderContext, startedAt: string): Promise<string> {
  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
  const tempDir = await mkdtemp(path.join(tmpdir(), "tripsync-video-"));
  const outputPath = path.join(VIDEO_OUTPUT_DIR, `${context.job._id}.webm`);

  try {
    const inputPaths = await downloadRenderPhotos(context.photos.slice(0, 6), tempDir);
    await runFfmpeg(inputPaths, context, outputPath);
    const fileStat = await stat(outputPath);
    const artifact: VideoJobArtifactDoc = {
      _id: `artifact_webm_${context.job._id}`,
      video_job_id: context.job._id,
      trip_id: context.job.trip_id,
      kind: "webm_video",
      content_type: "video/webm",
      file_path: outputPath,
      byte_length: fileStat.size,
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

async function downloadRenderPhotos(photos: PhotoLikeDoc[], tempDir: string): Promise<string[]> {
  const inputPaths: string[] = [];
  for (const [index, photo] of photos.entries()) {
    try {
      const res = await fetch(photo.url);
      if (!res.ok) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      const filePath = path.join(tempDir, `photo_${index}.jpg`);
      await writeFile(filePath, bytes);
      inputPaths.push(filePath);
    } catch {
      // Broken remote assets are skipped; the renderer only needs one usable photo.
    }
  }
  if (!inputPaths.length) throw new Error("no downloadable photos for mp4 render");
  return inputPaths;
}

async function runFfmpeg(inputPaths: string[], context: RenderContext, outputPath: string): Promise<void> {
  const fps = 24;
  const duration = Math.min(context.job.duration_seconds, 60);
  const segmentDuration = Math.max(3, duration / inputPaths.length);
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const inputPath of inputPaths) {
    args.push("-loop", "1", "-framerate", String(fps), "-t", String(segmentDuration), "-i", inputPath);
  }
  args.push("-f", "lavfi", "-t", String(duration), "-i", "sine=frequency=196:sample_rate=44100");

  const imageFilters = inputPaths.map((_, index) => {
    const frames = Math.ceil(segmentDuration * fps);
    return `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,zoompan=z='min(zoom+0.0018,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=${fps},setsar=1,trim=duration=${segmentDuration},setpts=PTS-STARTPTS[v${index}]`;
  });
  const concatInputs = inputPaths.map((_, index) => `[v${index}]`).join("");
  const audioInputIndex = inputPaths.length;
  const filter = [
    ...imageFilters,
    `${concatInputs}concat=n=${inputPaths.length}:v=1:a=0,trim=duration=${duration},format=yuv420p[v]`,
    `[${audioInputIndex}:a]volume=0.08[a]`,
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
    "libvpx",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    "-b:v",
    "2.4M",
    "-c:a",
    "libopus",
    "-b:a",
    "96k",
    outputPath,
  );

  await execFileAsync("ffmpeg", args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
}

function buildRecapHtml(context: RenderContext): string {
  const photoTiles = context.photos.slice(0, 6);
  const sceneCards = context.job.scenes.slice(0, 5);
  const messageHighlights = context.messages.slice(-4);
  const memberDots = context.members.slice(0, 4);
  const memory = context.memories[0];
  const sceneTimeline = buildSceneTimeline(context.job).slice(0, sceneCards.length);
  const sceneTimelineJson = serializeScriptJson(sceneTimeline);

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
    .photo {
      position: absolute;
      inset: 0;
      overflow: hidden;
      opacity: 0;
      transform: scale(1.02);
      transition: opacity 420ms linear;
    }
    .photo.is-visible { opacity: 1; z-index: 2; }
    .photo img {
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
      <div class="motion-label"><span class="motion-dot"></span>playing visual recap</div>
      ${photoTiles.map((photo, index) => renderPhoto(photo, index)).join("")}
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
        ${context.job.duration_seconds}s vertical fallback<br />
        ${context.photos.length} photos, ${context.messages.length} messages${memory ? `<br />Top memory: ${escapeText(memory.title)}` : ""}
      </article>
    </section>
  </main>
  <script>
    const sceneTimeline = ${sceneTimelineJson};
    const recapDurationSeconds = ${context.job.duration_seconds};
    const startButton = document.querySelector("[data-audio-start]");
    const audioState = document.querySelector("[data-audio-state]");
    const progressFill = document.querySelector("[data-progress-fill]");
    const sceneEls = Array.from(document.querySelectorAll("[data-scene-index]"));
    const photoEls = Array.from(document.querySelectorAll(".photo"));
    let audioContext = null;
    let startedAt = 0;
    let playing = false;
    let visualStartedAt = performance.now();

    startButton.addEventListener("click", async () => {
      if (playing) {
        stopRecap();
        return;
      }
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
      startedAt = audioContext.currentTime + 0.08;
      scheduleGeneratedScore(audioContext, startedAt, recapDurationSeconds);
      playing = true;
      startButton.textContent = "Stop audio";
      audioState.textContent = "Audio playing · scenes synced to soundtrack";
    });

    window.requestAnimationFrame(tick);

    function stopRecap() {
      playing = false;
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
      visualStartedAt = performance.now();
      startButton.textContent = "Start recap with audio";
      audioState.textContent = "Audio stopped · visual recap keeps playing";
    }

    function tick(now) {
      const elapsed = playing && audioContext
        ? Math.max(0, audioContext.currentTime - startedAt)
        : ((now - visualStartedAt) / 1000) % recapDurationSeconds;
      setProgress(Math.min(elapsed / recapDurationSeconds, 1) * 100);
      const active = sceneTimeline.find((scene) => elapsed >= scene.start && elapsed < scene.start + scene.duration);
      setActiveScene(active ? active.index : -1);
      setActivePhoto(elapsed);
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

    function scheduleGeneratedScore(ctx, startAt, durationSeconds) {
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, startAt);
      master.gain.exponentialRampToValueAtTime(0.22, startAt + 0.8);
      master.gain.setValueAtTime(0.22, startAt + Math.max(durationSeconds - 2, 1));
      master.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
      master.connect(ctx.destination);

      const chords = [
        [261.63, 329.63, 392.00],
        [293.66, 369.99, 440.00],
        [220.00, 329.63, 440.00],
        [246.94, 311.13, 392.00],
      ];
      for (let bar = 0; bar * 2 < durationSeconds; bar++) {
        const chord = chords[bar % chords.length];
        for (const freq of chord) {
          playTone(ctx, master, freq, startAt + bar * 2, 1.85, "sine", 0.055);
        }
      }
      for (let beat = 0; beat * 0.5 < durationSeconds; beat++) {
        const t = startAt + beat * 0.5;
        playTone(ctx, master, beat % 4 === 0 ? 130.81 : 196.00, t, 0.08, "triangle", beat % 4 === 0 ? 0.09 : 0.035);
      }
      for (const scene of sceneTimeline) {
        playTone(ctx, master, 880, startAt + scene.start, 0.16, "sine", 0.07);
      }
    }

    function playTone(ctx, output, frequency, startAt, duration, type, volume) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
      osc.connect(gain);
      gain.connect(output);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.05);
    }
  </script>
</body>
</html>`;
}

function buildSceneTimeline(job: VideoJobDoc): SceneTiming[] {
  const scenes = job.scenes.length ? job.scenes : [{
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

function renderPhoto(photo: PhotoLikeDoc, index: number): string {
  const caption = photo.caption ?? photo.place_name ?? "Trip moment";
  return `
    <figure class="photo${index === 0 ? " is-visible" : ""}">
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

function serializeScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export const _internal = {
  ARTIFACTS_COLLECTION,
  buildRecapHtml,
};
