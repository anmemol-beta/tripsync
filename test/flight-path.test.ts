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

describe("flight path: flight proposal -> votes -> decision", () => {
  it("turn 1: agent proposes flights", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "search_flights",
            args: {
              from: "ICN",
              to: "NRT",
              depart_date: "2026-05-26",
              return_date: "2026-05-30",
              max_price_krw: 500000,
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
              kind: "flight",
              prompt_summary: "ICN→NRT 5/26 출발, 예산 50만원",
              options: [
                {
                  id: "f_ke_085",
                  label: "KE 085 ICN→NRT",
                  detail: {
                    carrier: "Korean Air",
                    flight_number: "KE 085",
                    depart_airport: "ICN",
                    arrive_airport: "NRT",
                    depart_at: "2026-05-26T09:00:00+09:00",
                    arrive_at: "2026-05-26T11:20:00+09:00",
                    price_krw: 320000,
                  },
                },
                {
                  id: "f_oz_101",
                  label: "OZ 101 ICN→NRT",
                  detail: {
                    carrier: "Asiana Airlines",
                    flight_number: "OZ 101",
                    depart_airport: "ICN",
                    arrive_airport: "NRT",
                    depart_at: "2026-05-26T07:30:00+09:00",
                    arrive_at: "2026-05-26T09:45:00+09:00",
                    price_krw: 298000,
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
              payload: { kind: "flight" },
            },
          },
        ],
      },
      { kind: "text", text: "항공편 2개 후보 올렸어요. 투표해주세요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "ICN에서 도쿄 5/26 가는 항공편 추천해줘. 예산 50만원",
    });

    expect(trace.reply).toContain("투표");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "find_trip",
      "search_flights",
      "insert_proposal",
      "append_history",
    ]);

    const proposals = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, kind: "flight" })
      .toArray();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.status).toBe("open");
    expect(proposals[0]?.options).toHaveLength(2);
  });

  it("votes: three members cast votes", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "flight" });
    expect(proposal).not.toBeNull();
    const proposalId = proposal!._id;

    const now = () => "2026-05-11T01:00:00-04:00";
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "seo", option_id: "f_oz_101" });
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "jamie", option_id: "f_oz_101" });
    await appendVote({ db, now }, { proposal_id: proposalId, voter: "min", option_id: "f_ke_085" });

    const votes = await db
      .collection<VoteDoc>(COLLECTIONS.votes)
      .find({ proposal_id: proposalId })
      .toArray();
    expect(votes).toHaveLength(3);
  });

  it("turn 2: agent tallies, decides, persists", async () => {
    const proposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ trip_id: BOSTON_CREW_TRIP_ID, kind: "flight" });
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
              kind: "flight",
              winner_option_id: "f_oz_101",
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
              payload: { kind: "flight", option_id: "f_oz_101" },
            },
          },
        ],
      },
      { kind: "text", text: "OZ 101 결정됐어요. (2/3 표) 변경 이력에 기록했어요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "결정해줘",
    });

    expect(trace.reply).toContain("OZ 101");
    expect(trace.calls.map((c) => c.name)).toEqual([
      "tally_votes",
      "update_trip_decision",
      "append_history",
    ]);

    const trip = await db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: BOSTON_CREW_TRIP_ID });
    expect(trip?.decisions.flight?.id).toBe("f_oz_101");

    const decidedProposal = await db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .findOne({ _id: proposalId });
    expect(decidedProposal?.status).toBe("decided");

    const history = await db
      .collection<HistoryDoc>(COLLECTIONS.history)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, event_type: "decision_made" })
      .toArray();
    expect(history).toHaveLength(1);
    expect(history[0]?.payload).toMatchObject({ kind: "flight", option_id: "f_oz_101" });
  });
});
