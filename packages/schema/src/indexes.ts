import type { Db } from "mongodb";
import { COLLECTIONS } from "./index.js";

export async function applyIndexes(db: Db): Promise<void> {
  await db.collection(COLLECTIONS.proposals).createIndex(
    { trip_id: 1, kind: 1, status: 1 },
  );
  await db.collection(COLLECTIONS.votes).createIndex(
    { proposal_id: 1, voter: 1 },
    { unique: true },
  );
  await db.collection(COLLECTIONS.history).createIndex(
    { trip_id: 1, created_at: 1 },
  );
}
