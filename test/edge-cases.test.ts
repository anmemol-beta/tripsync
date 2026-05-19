import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type MemberDoc,
  type ProposalDoc,
  type TripDoc,
} from "@tripsync/schema";
import { appendVote, insertProposal, tallyVotes } from "@tripsync/agent";
import { createMemDb } from "./utils/memdb.js";

const TRIP_ID = "trip_edge_test";
const NOW = () => "2026-05-19T00:00:00.000Z";

const OPTIONS = [
  { id: "opt_a", label: "Option A", detail: {} },
  { id: "opt_b", label: "Option B", detail: {} },
];

async function setupDb(): Promise<Db> {
  const db = createMemDb();
  const trip: TripDoc = {
    _id: TRIP_ID,
    group_id: "grp_edge",
    title: "Edge Trip",
    destination: "Testland",
    start_date: "2026-06-01",
    end_date: "2026-06-05",
    status: "planning",
    budget_krw_per_night: 100000,
    decisions: { hotel: null, flight: null, activities: [] },
    created_at: NOW(),
    updated_at: NOW(),
  };
  await db.collection<TripDoc>(COLLECTIONS.trips).insertOne(trip);
  const members: MemberDoc[] = [
    { _id: "mem_a", trip_id: TRIP_ID, user_handle: "alice", display_name: "Alice", avatar_color: "#111111", role: "owner" },
    { _id: "mem_b", trip_id: TRIP_ID, user_handle: "bob", display_name: "Bob", avatar_color: "#222222", role: "member" },
    { _id: "mem_c", trip_id: TRIP_ID, user_handle: "carol", display_name: "Carol", avatar_color: "#333333", role: "member" },
  ];
  await db.collection<MemberDoc>(COLLECTIONS.members).insertMany(members);
  return db;
}

async function openProposal(db: Db): Promise<string> {
  const ctx = { db, now: NOW };
  const res = await insertProposal(ctx, {
    trip_id: TRIP_ID,
    proposed_by: "alice",
    kind: "hotel",
    prompt_summary: "test hotel",
    options: OPTIONS,
  });
  return res.proposal_id;
}

describe("edge cases", () => {
  describe("(a) tie vote → winner_option_id null", () => {
    it("returns null winner when two options are tied", async () => {
      const db = await setupDb();
      const propId = await openProposal(db);
      const ctx = { db, now: NOW };

      await appendVote(ctx, { proposal_id: propId, voter: "alice", option_id: "opt_a" });
      await appendVote(ctx, { proposal_id: propId, voter: "bob", option_id: "opt_b" });

      const tally = await tallyVotes(ctx, { proposal_id: propId });
      expect(tally.winner_option_id).toBeNull();
      expect(tally.total_voters).toBe(2);
    });
  });

  describe("(b) quorum not met → quorum_met false, proposal stays open", () => {
    it("quorum_met is false when fewer than ceil(members/2) votes cast", async () => {
      // 3 members → quorum = ceil(3/2) = 2; cast only 1 vote
      const db = await setupDb();
      const propId = await openProposal(db);
      const ctx = { db, now: NOW };

      await appendVote(ctx, { proposal_id: propId, voter: "alice", option_id: "opt_a" });

      const tally = await tallyVotes(ctx, { proposal_id: propId });
      expect(tally.quorum_met).toBe(false);
      expect(tally.total_voters).toBe(1);

      // proposal must still be open (update_trip_decision was NOT called)
      const prop = await db
        .collection<ProposalDoc>(COLLECTIONS.proposals)
        .findOne({ _id: propId });
      expect(prop?.status).toBe("open");
    });
  });

  describe("(c) re-vote overwrites; distinct-voter count stays correct", () => {
    it("same voter voting twice counts as one voter", async () => {
      const db = await setupDb();
      const propId = await openProposal(db);
      const ctx = { db, now: NOW };

      await appendVote(ctx, { proposal_id: propId, voter: "alice", option_id: "opt_a" });
      // alice changes her vote to opt_b
      await appendVote(ctx, { proposal_id: propId, voter: "alice", option_id: "opt_b" });

      const tally = await tallyVotes(ctx, { proposal_id: propId });
      expect(tally.total_voters).toBe(1);
      // opt_a should have 0 votes, opt_b should have 1
      const optA = tally.by_option.find((o) => o.option_id === "opt_a");
      const optB = tally.by_option.find((o) => o.option_id === "opt_b");
      expect(optA).toBeUndefined();
      expect(optB?.count).toBe(1);
      expect(optB?.voters).toEqual(["alice"]);
    });
  });

  describe("(d) insert_proposal rejects a second open proposal of the same kind", () => {
    it("throws when an open proposal of the same kind already exists", async () => {
      const db = await setupDb();
      await openProposal(db);
      const ctx = { db, now: NOW };

      await expect(
        insertProposal(ctx, {
          trip_id: TRIP_ID,
          proposed_by: "bob",
          kind: "hotel",
          prompt_summary: "second hotel attempt",
          options: OPTIONS,
        }),
      ).rejects.toThrow("open proposal already exists for kind=hotel");
    });
  });
});
