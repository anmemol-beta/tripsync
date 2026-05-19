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

describe("happy path: hotel proposal -> votes -> decision", () => {
  it("turn 1: agent proposes hotels", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "search_hotels",
            args: {
              destination: "Tokyo, Japan",
              check_in: "2026-05-26",
              check_out: "2026-05-30",
              max_price_per_night_krw: 150000,
              preferences: ["near_shibuya"],
            },
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
              kind: "hotel",
              prompt_summary: "Shibuya 근처 호텔, 예산 1박 15만원",
              options: [
                {
                  id: "h_shibuya_grandvel",
                  label: "Shibuya Grandvel Hotel",
                  detail: {
                    area: "Tokyo — Shibuya",
                    price_per_night_krw: 140000,
                    rating: 4.4,
                    amenities: ["breakfast", "wifi"],
                    walk_to_station_min: 3,
                  },
                },
                {
                  id: "h_shibuya_excel",
                  label: "Shibuya Excel Tokyu",
                  detail: {
                    area: "Tokyo — Shibuya",
                    price_per_night_krw: 145000,
                    rating: 4.5,
                    amenities: ["breakfast", "wifi"],
                    walk_to_station_min: 1,
                  },
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
              payload: { kind: "hotel" },
            },
          },
        ],
      },
      { kind: "text", text: "2개 후보 올렸어요. 투표해주세요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText:
        "우리 도쿄 5/26-5/30 갈건데 시부야 근처 호텔 추천해줘. 예산 1박 15만원",
    });

    expect(trace.reply).toContain("투표");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "find_trip",
      "search_hotels",
      "insert_proposal",
      "append_history",
    ]);

    const proposals = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, kind: "hotel" })
      .toArray();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("open");
    expect(proposals[0]?.options).toHaveLength(2);
  });

  it("votes: three members cast votes", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "hotel" });
    expect(proposal).not.toBeNull();
    const proposalId = proposal!._id;

    const now = () => "2026-05-11T01:00:00-04:00";
    await appendVote({ db, now }, {
      proposal_id: proposalId,
      voter: "seo",
      option_id: "h_shibuya_excel",
    });
    await appendVote({ db, now }, {
      proposal_id: proposalId,
      voter: "jamie",
      option_id: "h_shibuya_excel",
    });
    await appendVote({ db, now }, {
      proposal_id: proposalId,
      voter: "min",
      option_id: "h_shibuya_grandvel",
    });

    const votes = await db
      .collection<VoteDoc>(COLLECTIONS.votes)
      .find({ proposal_id: proposalId })
      .toArray();
    expect(votes).toHaveLength(3);
  });

  it("turn 2: agent tallies, decides, persists", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "hotel" });
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
              kind: "hotel",
              winner_option_id: "h_shibuya_excel",
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
              payload: { kind: "hotel", option_id: "h_shibuya_excel" },
            },
          },
        ],
      },
      {
        kind: "text",
        text: "Shibuya Excel Tokyu 결정됐어요. (2/3 표) 변경 이력에 기록했어요.",
      },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "결정해줘",
    });

    expect(trace.reply).toContain("Shibuya Excel Tokyu");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "tally_votes",
      "update_trip_decision",
      "append_history",
    ]);

    const trip = await db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: BOSTON_CREW_TRIP_ID });
    expect(trip?.decisions.hotel?.id).toBe("h_shibuya_excel");

    const decidedProposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ _id: proposalId });
    expect(decidedProposal?.status).toBe("decided");

    const history = await db
      .collection<HistoryDoc>(COLLECTIONS.history)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, event_type: "decision_made" })
      .toArray();
    expect(history).toHaveLength(1);
    expect(history[0]?.payload).toMatchObject({ kind: "hotel", option_id: "h_shibuya_excel" });
  });
});
