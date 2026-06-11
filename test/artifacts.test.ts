import { stat } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  COLLECTIONS,
  type EventDoc,
  type ExpenseDoc,
  type MediaAssetDoc,
  type PhotoDoc,
  type TicketDoc,
  type VideoJobDoc,
} from "@tripsync/schema";
import { BOSTON_CREW_TRIP_ID, bostonCrewFixture, seedBostonCrew } from "@tripsync/seed";
import { MockGeminiClient } from "@tripsync/agent";
import { buildApp } from "../apps/api/src/app.js";

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db("tripsync_artifacts_test");
  await seedBostonCrew(db);
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
});

describe("trip artifacts", () => {
  it("keeps seeded chat as realistic English trip conversation", () => {
    const chatBody = bostonCrewFixture.messages.map((message) => message.body).join("\n");

    expect(chatBody).not.toMatch(/\b(demo|prove|judges?)\b/i);
    expect(chatBody).not.toMatch(/[가-힣]/);
  });

  it("seeds itinerary, tickets, expenses, and photos into MongoDB", async () => {
    const [events, tickets, expenses, photos, mediaAssets, videoJobs] = await Promise.all([
      db.collection<EventDoc>(COLLECTIONS.events).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<TicketDoc>(COLLECTIONS.tickets).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<ExpenseDoc>(COLLECTIONS.expenses).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<PhotoDoc>(COLLECTIONS.photos).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<MediaAssetDoc>(COLLECTIONS.mediaAssets).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<VideoJobDoc>(COLLECTIONS.videoJobs).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
    ]);

    expect(events).toHaveLength(bostonCrewFixture.events.length);
    expect(tickets).toHaveLength(bostonCrewFixture.tickets.length);
    expect(expenses).toHaveLength(bostonCrewFixture.expenses.length);
    expect(photos).toHaveLength(bostonCrewFixture.photos.length);
    expect(mediaAssets).toHaveLength(bostonCrewFixture.mediaAssets.length);
    expect(tickets.find((ticket) => ticket._id === "ticket_teamlab")?.qr_data).toContain(
      "TLB-44109",
    );
    expect(tickets.every((ticket) => ticket.pdf_url?.includes("/assets/demo/tickets/"))).toBe(true);
    expect(expenses.find((expense) => expense._id === "expense_hotel_deposit")?.split_among)
      .toEqual(["seo", "jamie", "min"]);
    expect(expenses.filter((expense) => expense.receipt_url)).toHaveLength(3);
    expect(photos.every((photo) => photo.url.includes("/assets/demo/photos/"))).toBe(true);
    expect(mediaAssets).toHaveLength(8);
    expect(mediaAssets.every((asset) => asset.file_url.includes("/assets/demo/videos/"))).toBe(true);
    expect(mediaAssets.map((asset) => asset.original_name)).toContain("friends-under-tree.mp4");
    await expect(Promise.all(mediaAssets.map((asset) => stat(asset.file_path)))).resolves.toHaveLength(8);
    expect(videoJobs).toHaveLength(1);
    expect(videoJobs[0]?.status).toBe("brief_ready");
  });

  it("returns artifacts and settlement from the trip state API", async () => {
    const app = buildApp({ db, gemini: new MockGeminiClient([]) });
    const response = await app.request(`/trip/${BOSTON_CREW_TRIP_ID}/state`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      events: EventDoc[];
      tickets: TicketDoc[];
      expenses: ExpenseDoc[];
      photos: PhotoDoc[];
      media_assets: MediaAssetDoc[];
      video_jobs: VideoJobDoc[];
      settlement: {
        totals_by_currency: Array<{ currency: string; amount: number }>;
        transfers: Array<{ from: string; to: string; amount: number; currency: string }>;
      };
    };

    expect(body.events.map((event) => event._id)).toEqual([
      "event_hnd_arrival",
      "event_hotel_checkin",
      "event_teamlab_entry",
      "event_daikanyama_walk",
    ]);
    expect(body.tickets.every((ticket) => ticket.qr_data)).toBe(true);
    expect(body.expenses.map((expense) => expense._id)).toEqual([
      "expense_suica_topup",
      "expense_punjab_dinner",
      "expense_izakaya_dinner",
      "expense_hotel_deposit",
    ]);
    expect(body.photos[0]?._id).toBe("photo_hnd_arrival_seo");
    expect(body.media_assets).toHaveLength(8);
    expect(body.video_jobs[0]?.status).toBe("brief_ready");
    expect(body.settlement.totals_by_currency).toEqual([{ currency: "KRW", amount: 840000 }]);
    expect(body.settlement.transfers).toEqual([
      { from: "min", to: "jamie", amount: 169999, currency: "KRW" },
      { from: "seo", to: "jamie", amount: 141999, currency: "KRW" },
    ]);
  });
});
