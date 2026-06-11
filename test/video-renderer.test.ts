import { rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { COLLECTIONS, type MediaAssetDoc, type MessageDoc, type VideoJobDoc } from "@tripsync/schema";
import { MockGeminiClient } from "@tripsync/agent";
import { BOSTON_CREW_TRIP_ID, seedBostonCrew } from "@tripsync/seed";
import { buildApp } from "../apps/api/src/app.js";

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db("tripsync_video_test");
}, 60_000);

beforeEach(async () => {
  await db.dropDatabase();
  await seedBostonCrew(db);
});

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe("video job HTML fallback renderer", () => {
  it("stores uploaded chat videos as media assets with an auto trim", async () => {
    const app = buildApp({
      db,
      gemini: new MockGeminiClient([]),
      publicBaseUrl: "http://test.local",
      videoRenderMode: "html",
    });
    const form = new FormData();
    form.set("author", "seo");
    form.set("caption", "Haneda arrival clip");
    form.set("file", new File([Buffer.from("placeholder")], "arrival.mp4", { type: "video/mp4" }));

    const uploadRes = await app.request(`/trip/${BOSTON_CREW_TRIP_ID}/media`, {
      method: "POST",
      body: form,
    });
    expect(uploadRes.status).toBe(200);
    const uploadBody = (await uploadRes.json()) as { media_asset: MediaAssetDoc };
    expect(uploadBody.media_asset).toMatchObject({
      trip_id: BOSTON_CREW_TRIP_ID,
      member_handle: "seo",
      kind: "video",
      original_name: "arrival.mp4",
      trim_start_seconds: 0,
      status: "ready",
    });
    expect(uploadBody.media_asset.file_url).toBe(`http://test.local/uploads/${uploadBody.media_asset._id}.mp4`);

    const persisted = await db
      .collection<MediaAssetDoc>(COLLECTIONS.mediaAssets)
      .findOne({ _id: uploadBody.media_asset._id });
    expect(persisted?.caption).toBe("Haneda arrival clip");

    const messages = await db
      .collection<MessageDoc>(COLLECTIONS.messages)
      .find({ _id: { $in: [`msg_${uploadBody.media_asset._id}`, `msg_${uploadBody.media_asset._id}_agent`] } })
      .toArray();
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.body).join("\n")).toContain("Added to the next recap render");

    await rm(uploadBody.media_asset.file_path, { force: true });
  });

  it("moves a brief_ready video job to ready and stores a preview URL", async () => {
    await insertVideoJob("video_test_ready", "brief_ready");
    const app = buildApp({
      db,
      gemini: new MockGeminiClient([]),
      publicBaseUrl: "http://test.local",
      videoRenderMode: "html",
    });

    const renderRes = await app.request("/video-jobs/video_test_ready/render", {
      method: "POST",
    });
    expect(renderRes.status).toBe(200);
    expect(await renderRes.json()).toMatchObject({
      video_job_id: "video_test_ready",
      status: "ready",
      output_url: "http://test.local/video-jobs/video_test_ready/preview",
    });

    const job = await db
      .collection<VideoJobDoc>(COLLECTIONS.videoJobs)
      .findOne({ _id: "video_test_ready" });
    expect(job?.status).toBe("ready");
    expect(job?.output_url).toBe("http://test.local/video-jobs/video_test_ready/preview");
    expect(job?.failure_reason).toBeNull();

    const previewRes = await app.request("/video-jobs/video_test_ready/preview");
    expect(previewRes.status).toBe(200);
    expect(previewRes.headers.get("content-type")).toContain("text/html");
    const html = await previewRes.text();
    expect(html).toContain("width: 1080px");
    expect(html).toContain("height: 1920px");
    expect(html).toContain("Tokyo 5/26-5/30 recap");
    expect(html).toContain("images.unsplash.com");
    expect(html).toContain("Start recap with audio");
    expect(html).toContain("data-audio-state");
    expect(html).toContain("data-soundtrack");
    expect(html).toContain("http://test.local/assets/tripsync-music.mp3");
    expect(html).toContain("const sceneTimeline");
    expect(html).toContain("data-scene-index=\"0\"");

    const audioRes = await app.request("/assets/tripsync-music.mp3");
    expect(audioRes.status).toBe(200);
    expect(audioRes.headers.get("content-type")).toContain("audio/mpeg");
  });

  it("marks a render failed when the trip backing the job is missing", async () => {
    await insertVideoJob("video_test_failed", "brief_ready", "missing_trip");
    const app = buildApp({
      db,
      gemini: new MockGeminiClient([]),
      publicBaseUrl: "http://test.local",
      videoRenderMode: "html",
    });

    const renderRes = await app.request("/video-jobs/video_test_failed/render", {
      method: "POST",
    });
    expect(renderRes.status).toBe(500);

    const job = await db
      .collection<VideoJobDoc>(COLLECTIONS.videoJobs)
      .findOne({ _id: "video_test_failed" });
    expect(job?.status).toBe("failed");
    expect(job?.failure_reason).toContain("trip not found");
    expect(job?.output_url).toBeNull();
  });
});

async function insertVideoJob(
  id: string,
  status: VideoJobDoc["status"],
  tripId = BOSTON_CREW_TRIP_ID,
): Promise<void> {
  const now = "2026-05-11T01:30:00-04:00";
  const doc: VideoJobDoc = {
    _id: id,
    trip_id: tripId,
    requested_by: "seo",
    status,
    format: "vertical_9_16",
    duration_seconds: 60,
    title: "Tokyo 5/26-5/30 recap",
    narrative: "A vertical recap from the group planning brief.",
    scenes: [
      {
        id: "scene_1",
        title: "Plan opens",
        source: "message",
        prompt: "Friends settle on Tokyo dates in chat.",
        duration_seconds: 12,
        asset_refs: ["msg_001", "msg_002"],
      },
      {
        id: "scene_2",
        title: "Hotel vote",
        source: "decision",
        prompt: "The group compares hotel options and vote context.",
        duration_seconds: 24,
        asset_refs: ["h_shibuya_excel"],
      },
      {
        id: "scene_3",
        title: "Ready for Tokyo",
        source: "agent_memory",
        prompt: "A final card sets up the trip.",
        duration_seconds: 24,
        asset_refs: [tripId],
      },
    ],
    output_url: null,
    failure_reason: null,
    created_at: now,
    updated_at: now,
  };
  await db.collection<VideoJobDoc>(COLLECTIONS.videoJobs).insertOne(doc);
}
