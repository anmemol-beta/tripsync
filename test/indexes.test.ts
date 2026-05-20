import { describe, expect, it } from "vitest";
import { COLLECTIONS, applyIndexes } from "@tripsync/schema";
import type { VoteDoc } from "@tripsync/schema";
import { createMemDb } from "./utils/memdb.js";

const NOW = "2026-05-20T00:00:00.000Z";

describe("MongoDB indices", () => {
  it("applyIndexes runs without error on all three collections", async () => {
    const db = createMemDb();
    await expect(applyIndexes(db)).resolves.toBeUndefined();
  });

  it("unique index on votes(proposal_id, voter) rejects a duplicate insert", async () => {
    const db = createMemDb();
    await applyIndexes(db);

    const votes = db.collection<VoteDoc>(COLLECTIONS.votes);
    await votes.insertOne({
      _id: "v1",
      proposal_id: "p1",
      voter: "alice",
      option_id: "opt_a",
      created_at: NOW,
    });

    await expect(
      votes.insertOne({
        _id: "v2",
        proposal_id: "p1",
        voter: "alice",
        option_id: "opt_b",
        created_at: NOW,
      }),
    ).rejects.toThrow(/E11000/);
  });

  it("unique index allows same voter on different proposals", async () => {
    const db = createMemDb();
    await applyIndexes(db);

    const votes = db.collection<VoteDoc>(COLLECTIONS.votes);
    await votes.insertOne({
      _id: "v1",
      proposal_id: "p1",
      voter: "alice",
      option_id: "opt_a",
      created_at: NOW,
    });
    // Different proposal_id — must succeed
    await expect(
      votes.insertOne({
        _id: "v2",
        proposal_id: "p2",
        voter: "alice",
        option_id: "opt_a",
        created_at: NOW,
      }),
    ).resolves.toBeDefined();
  });
});
