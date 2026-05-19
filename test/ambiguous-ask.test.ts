import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { BOSTON_CREW_TRIP_ID, seedBostonCrew } from "@tripsync/seed";
import { MockGeminiClient, runTurn } from "@tripsync/agent";
import { createMemDb } from "./utils/memdb.js";

let db: Db;

beforeAll(async () => {
  db = createMemDb();
  await seedBostonCrew(db);
});

describe("HITL §4.1: ambiguous ask → clarifying question, no search or proposal", () => {
  it("when hotel ask has no dates/budget, agent replies with a question and makes no tool calls", async () => {
    const clarifyingQuestion = "여행 날짜와 1박 예산을 알려주시겠어요?";
    const gemini = new MockGeminiClient([
      { kind: "text", text: clarifyingQuestion },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "호텔 추천해줘",
    });

    const searchOrProposalCalls = trace.calls.filter((c) =>
      ["search_hotels", "search_flights", "search_activities", "insert_proposal"].includes(c.name),
    );
    expect(searchOrProposalCalls).toHaveLength(0);
    expect(trace.reply).toContain("?");
  });
});
