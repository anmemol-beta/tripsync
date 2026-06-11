import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  COLLECTIONS,
  type EventDoc,
  type ExpenseDoc,
  type PhotoDoc,
  type TicketDoc,
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
  it("seeds itinerary, tickets, expenses, and photos into MongoDB", async () => {
    const [events, tickets, expenses, photos] = await Promise.all([
      db.collection<EventDoc>(COLLECTIONS.events).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<TicketDoc>(COLLECTIONS.tickets).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<ExpenseDoc>(COLLECTIONS.expenses).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
      db.collection<PhotoDoc>(COLLECTIONS.photos).find({ trip_id: BOSTON_CREW_TRIP_ID }).toArray(),
    ]);

    expect(events).toHaveLength(bostonCrewFixture.events.length);
    expect(tickets).toHaveLength(bostonCrewFixture.tickets.length);
    expect(expenses).toHaveLength(bostonCrewFixture.expenses.length);
    expect(photos).toHaveLength(bostonCrewFixture.photos.length);
    expect(tickets.find((ticket) => ticket._id === "ticket_teamlab")?.qr_data).toContain(
      "TLB-44109",
    );
    expect(expenses.find((expense) => expense._id === "expense_hotel_deposit")?.split_among)
      .toEqual(["seo", "jamie", "min"]);
    expect(photos.filter((photo) => photo.place_name === "Azabudai Hills")).toHaveLength(3);
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
      "expense_izakaya_dinner",
      "expense_hotel_deposit",
    ]);
    expect(body.photos[0]?._id).toBe("photo_hnd_arrival_seo");
    expect(body.settlement.totals_by_currency).toEqual([{ currency: "KRW", amount: 775000 }]);
    expect(body.settlement.transfers).toEqual([
      { from: "min", to: "jamie", amount: 213333, currency: "KRW" },
      { from: "seo", to: "jamie", amount: 120333, currency: "KRW" },
    ]);
  });
});
