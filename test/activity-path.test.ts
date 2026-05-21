import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type HistoryDoc,
  type ProposalDoc,
  type TripDoc,
  type VoteDoc,
} from "@tripsync/schema";
import { BOSTON_CREW_TRIP_ID, seedBostonCrew } from "@tripsync/seed";
import { MockGeminiClient, runTurn, appendVote } from "@tripsync/agent";
import { createMemDb } from "./utils/memdb.js";

let db: Db;

beforeAll(async () => {
  db = createMemDb();
  await seedBostonCrew(db);
});

describe("activity path: two activity proposals both decided", () => {
  it("turn 1: agent proposes first activity", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "search_activities",
            args: { destination: "Tokyo, Japan", themes: ["digital art"], max_price_krw: 50000 },
          },
        ],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "insert_proposal",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              proposed_by: "seo",
              kind: "activity",
              prompt_summary: "도쿄 디지털 아트 체험",
              options: [
                {
                  id: "act_teamlab",
                  label: "teamLab Borderless",
                  detail: { name: "teamLab Borderless", area: "Tokyo, Japan — Odaiba", price_krw: 32000, duration_min: 120 },
                },
                {
                  id: "act_shibuya_sky",
                  label: "Shibuya Sky Observatory",
                  detail: { name: "Shibuya Sky Observatory", area: "Tokyo, Japan — Shibuya", price_krw: 23000, duration_min: 60 },
                },
              ],
            },
          },
        ],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "append_history",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              event_type: "proposal_opened",
              actor: "agent",
              payload: { kind: "activity" },
            },
          },
        ],
      },
      { kind: "text", text: "액티비티 후보 2개 올렸어요. 투표해주세요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "도쿄에서 할 수 있는 디지털 아트 체험 추천해줘",
    });

    expect(trace.reply).toContain("투표");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "find_trip",
      "search_activities",
      "insert_proposal",
      "append_history",
    ]);

    const proposals = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, kind: "activity" })
      .toArray();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("open");
  });

  it("votes for activity 1: three members vote", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "activity", status: "open" });
    expect(proposal).not.toBeNull();
    const proposalId = proposal!._id;

    const now = () => "2026-05-11T01:00:00-04:00";
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "seo", option_id: "act_teamlab" });
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "jamie", option_id: "act_teamlab" });
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "min", option_id: "act_shibuya_sky" });

    const votes = await db
      .collection<VoteDoc>(COLLECTIONS.votes)
      .find({ proposal_id: proposalId })
      .toArray();
    expect(votes).toHaveLength(3);
  });

  it("turn 2: agent tallies and decides activity 1", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "activity", status: "open" });
    const proposalId = proposal!._id;

    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "tally_votes", args: { proposal_id: proposalId } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "update_trip_decision",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              proposal_id: proposalId,
              kind: "activity",
              winner_option_id: "act_teamlab",
            },
          },
        ],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "append_history",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              event_type: "decision_made",
              actor: "agent",
              payload: { kind: "activity", option_id: "act_teamlab" },
            },
          },
        ],
      },
      { kind: "text", text: "teamLab Borderless 결정됐어요. (2/3 표)" },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "첫 번째 액티비티 결정해줘",
    });

    expect(trace.reply).toContain("teamLab");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "tally_votes",
      "update_trip_decision",
      "append_history",
    ]);

    const decided = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ _id: proposalId });
    expect(decided?.status).toBe("decided");

    const trip = await db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: BOSTON_CREW_TRIP_ID });
    expect(trip?.decisions.activities).toHaveLength(1);
    expect(trip?.decisions.activities[0]?.id).toBe("act_teamlab");
  });

  it("turn 3: agent proposes second activity", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "search_activities",
            args: { destination: "Tokyo, Japan", themes: ["food"], max_price_krw: 30000 },
          },
        ],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "insert_proposal",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              proposed_by: "jamie",
              kind: "activity",
              prompt_summary: "도쿄 음식 투어",
              options: [
                {
                  id: "act_tsukiji",
                  label: "Tsukiji Outer Market Food Tour",
                  detail: { name: "Tsukiji Outer Market Food Tour", area: "Tokyo, Japan — Tsukiji", price_krw: 25000, duration_min: 120 },
                },
                {
                  id: "act_senso_ji",
                  label: "Senso-ji Temple Tour",
                  detail: { name: "Senso-ji Temple Tour", area: "Tokyo, Japan — Asakusa", price_krw: 0, duration_min: 90 },
                },
              ],
            },
          },
        ],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "append_history",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              event_type: "proposal_opened",
              actor: "agent",
              payload: { kind: "activity" },
            },
          },
        ],
      },
      { kind: "text", text: "두 번째 액티비티 후보 올렸어요. 투표해주세요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "jamie",
      userText: "음식 관련 액티비티도 추가해줘",
    });

    expect(trace.reply).toContain("투표");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "find_trip",
      "search_activities",
      "insert_proposal",
      "append_history",
    ]);

    const openProposals = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, kind: "activity", status: "open" })
      .toArray();
    expect(openProposals).toHaveLength(1);
  });

  it("votes for activity 2: three members vote", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "activity", status: "open" });
    expect(proposal).not.toBeNull();
    const proposalId = proposal!._id;

    const now = () => "2026-05-11T02:00:00-04:00";
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "seo", option_id: "act_tsukiji" });
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "jamie", option_id: "act_tsukiji" });
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "min", option_id: "act_tsukiji" });

    const votes = await db
      .collection<VoteDoc>(COLLECTIONS.votes)
      .find({ proposal_id: proposalId })
      .toArray();
    expect(votes).toHaveLength(3);
  });

  it("turn 4: agent tallies and decides activity 2", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "activity", status: "open" });
    const proposalId = proposal!._id;

    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "tally_votes", args: { proposal_id: proposalId } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "update_trip_decision",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              proposal_id: proposalId,
              kind: "activity",
              winner_option_id: "act_tsukiji",
            },
          },
        ],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "append_history",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              event_type: "decision_made",
              actor: "agent",
              payload: { kind: "activity", option_id: "act_tsukiji" },
            },
          },
        ],
      },
      { kind: "text", text: "츠키지 음식 투어 결정됐어요. (3/3 표)" },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "jamie",
      userText: "두 번째 액티비티 결정해줘",
    });

    expect(trace.reply).toContain("츠키지");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "tally_votes",
      "update_trip_decision",
      "append_history",
    ]);

    const decided = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ _id: proposalId });
    expect(decided?.status).toBe("decided");

    const trip = await db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: BOSTON_CREW_TRIP_ID });
    expect(trip?.decisions.activities).toHaveLength(2);
    expect(trip?.decisions.activities[0]?.id).toBe("act_teamlab");
    expect(trip?.decisions.activities[1]?.id).toBe("act_tsukiji");

    const historyRows = await db
      .collection<HistoryDoc>(COLLECTIONS.history)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, event_type: "decision_made" })
      .toArray();
    expect(historyRows.filter((h) => h.payload["kind"] === "activity")).toHaveLength(2);
  });
});
