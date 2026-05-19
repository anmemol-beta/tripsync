import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type MemberDoc,
  type TripDoc,
} from "@tripsync/schema";
import {
  appendHistory,
  appendVote,
  getTripHistory,
  insertProposal,
  updateTripDecision,
} from "@tripsync/agent";
import { createMemDb } from "./utils/memdb.js";

const TRIP_ID = "trip_hist_test";
const NOW = () => "2026-05-19T00:00:00.000Z";

let db: Db;

beforeAll(async () => {
  db = createMemDb();
  const trip: TripDoc = {
    _id: TRIP_ID,
    group_id: "grp_hist",
    title: "History Trip",
    destination: "Seoul",
    start_date: "2026-07-01",
    end_date: "2026-07-05",
    status: "planning",
    budget_krw_per_night: 100000,
    decisions: { hotel: null, flight: null, activities: [] },
    created_at: NOW(),
    updated_at: NOW(),
  };
  await db.collection<TripDoc>(COLLECTIONS.trips).insertOne(trip);
  const members: MemberDoc[] = [
    { _id: "m1", trip_id: TRIP_ID, user_handle: "alice", display_name: "Alice", avatar_color: "#aaaaaa", role: "owner" },
    { _id: "m2", trip_id: TRIP_ID, user_handle: "bob", display_name: "Bob", avatar_color: "#bbbbbb", role: "member" },
  ];
  await db.collection<MemberDoc>(COLLECTIONS.members).insertMany(members);
});

describe("get_trip_history", () => {
  it("returns decision_made history row after a decision", async () => {
    const ctx = { db, now: NOW };

    const { proposal_id } = await insertProposal(ctx, {
      trip_id: TRIP_ID,
      proposed_by: "alice",
      kind: "hotel",
      prompt_summary: "hotel near gangnam",
      options: [{ id: "h1", label: "Grand Hotel", detail: {} }],
    });

    await appendVote(ctx, { proposal_id, voter: "alice", option_id: "h1" });
    await appendVote(ctx, { proposal_id, voter: "bob", option_id: "h1" });

    await updateTripDecision(ctx, {
      trip_id: TRIP_ID,
      proposal_id,
      kind: "hotel",
      winner_option_id: "h1",
    });

    await appendHistory(ctx, {
      trip_id: TRIP_ID,
      event_type: "decision_made",
      actor: "agent",
      payload: { kind: "hotel", option_id: "h1" },
    });

    const history = await getTripHistory(ctx, { trip_id: TRIP_ID });
    expect(history.length).toBeGreaterThan(0);
    const decisionRow = history.find((h) => h.event_type === "decision_made");
    expect(decisionRow).toBeDefined();
    expect(decisionRow?.payload).toMatchObject({ kind: "hotel", option_id: "h1" });
    expect(decisionRow?.trip_id).toBe(TRIP_ID);
  });

  it("respects the limit parameter", async () => {
    const ctx = { db, now: NOW };
    await appendHistory(ctx, {
      trip_id: TRIP_ID,
      event_type: "agent_note",
      actor: "agent",
      payload: { note: "extra row" },
    });

    const limited = await getTripHistory(ctx, { trip_id: TRIP_ID, limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("returns empty array for unknown trip_id", async () => {
    const ctx = { db, now: NOW };
    const history = await getTripHistory(ctx, { trip_id: "nonexistent_trip" });
    expect(history).toHaveLength(0);
  });
});
