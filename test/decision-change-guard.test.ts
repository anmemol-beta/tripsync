import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COLLECTIONS, type MemberDoc, type TripDoc } from "@tripsync/schema";
import { insertProposal } from "@tripsync/agent";
import { createMemDb } from "./utils/memdb.js";

const TRIP_ID = "trip_guard_test";
const NOW = () => "2026-05-19T00:00:00.000Z";

const DECIDED_HOTEL = {
  id: "h_decided",
  label: "Already Decided Hotel",
  detail: { area: "Tokyo", price_per_night_krw: 130000 },
};

const OPTIONS = [
  { id: "opt_a", label: "New Option A", detail: {} },
  { id: "opt_b", label: "New Option B", detail: {} },
];

let db: Db;

beforeEach(async () => {
  db = createMemDb();
  const trip: TripDoc = {
    _id: TRIP_ID,
    group_id: "grp_guard",
    title: "Guard Trip",
    destination: "Tokyo, Japan",
    start_date: "2026-06-01",
    end_date: "2026-06-05",
    status: "planning",
    budget_krw_per_night: 150000,
    decisions: { hotel: DECIDED_HOTEL, flight: null, activities: [] },
    created_at: NOW(),
    updated_at: NOW(),
  };
  await db.collection<TripDoc>(COLLECTIONS.trips).insertOne(trip);
  const members: MemberDoc[] = [
    {
      _id: "mem_a",
      trip_id: TRIP_ID,
      user_handle: "alice",
      display_name: "Alice",
      avatar_color: "#111111",
      role: "owner",
    },
    {
      _id: "mem_b",
      trip_id: TRIP_ID,
      user_handle: "bob",
      display_name: "Bob",
      avatar_color: "#222222",
      role: "member",
    },
  ];
  await db.collection<MemberDoc>(COLLECTIONS.members).insertMany(members);
});

describe("HITL §4.3: decision-change guard", () => {
  it("insert_proposal rejects a hotel proposal when hotel is already decided", async () => {
    const ctx = { db, now: NOW };
    await expect(
      insertProposal(ctx, {
        trip_id: TRIP_ID,
        proposed_by: "alice",
        kind: "hotel",
        prompt_summary: "looking for a new hotel",
        options: OPTIONS,
      }),
    ).rejects.toThrow("decision already exists for kind=hotel");
  });

  it("insert_proposal allows activity proposals regardless of existing hotel decision", async () => {
    const ctx = { db, now: NOW };
    const res = await insertProposal(ctx, {
      trip_id: TRIP_ID,
      proposed_by: "alice",
      kind: "activity",
      prompt_summary: "teamLab Planets visit",
      options: OPTIONS,
    });
    expect(res.proposal_id).toBeTruthy();
  });
});
