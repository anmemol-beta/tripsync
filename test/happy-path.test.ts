import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  COLLECTIONS,
  type HistoryDoc,
  type ProposalDoc,
  type TripDoc,
  type VideoJobDoc,
  type VoteDoc,
} from "@tripsync/schema";
import { BOSTON_CREW_TRIP_ID, seedBostonCrew } from "@tripsync/seed";
import { MockGeminiClient, runTurn, appendVote } from "@tripsync/agent";

let mongod: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = new MongoClient(mongod.getUri());
  await client.connect();
  db = client.db("tripsync_test");
  await seedBostonCrew(db);
}, 60_000);

afterAll(async () => {
  await client.close();
  await mongod.stop();
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

  it("turn 3: agent creates a travel video brief", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "create_travel_video",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              requested_by: "seo",
              duration_seconds: 60,
              narrative: "Boston Crew가 도쿄 숙소를 투표로 정하고 여행을 시작하는 세로 영상",
              scenes: [
                {
                  title: "Tokyo plan opens",
                  source: "message",
                  prompt: "친구들이 도쿄 여행 날짜를 확정하는 채팅 말풍선",
                  duration_seconds: 12,
                  asset_refs: ["msg_001", "msg_002", "msg_003"],
                },
                {
                  title: "Hotel vote",
                  source: "decision",
                  prompt: "시부야 호텔 후보와 2대1 투표 결과를 빠르게 보여주는 장면",
                  duration_seconds: 24,
                  asset_refs: ["h_shibuya_excel"],
                },
                {
                  title: "Ready for Tokyo",
                  source: "agent_memory",
                  prompt: "결정된 숙소를 중심으로 도쿄 여행이 시작되는 엔딩 카드",
                  duration_seconds: 24,
                  asset_refs: [BOSTON_CREW_TRIP_ID],
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
              event_type: "video_job_created",
              actor: "agent",
              payload: { duration_seconds: 60 },
            },
          },
        ],
      },
      { kind: "text", text: "60초 세로 여행영상 브리프를 만들어뒀어요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "여행영상 만들어줘",
    });

    expect(trace.calls.map((c) => c.name)).toEqual([
      "find_trip",
      "create_travel_video",
      "append_history",
    ]);

    const jobs = await db
      .collection<VideoJobDoc>(COLLECTIONS.videoJobs)
      .find({ trip_id: BOSTON_CREW_TRIP_ID })
      .toArray();
    expect(jobs).toHaveLength(2);
    const createdJob = jobs.find((job) => job._id !== "video_travel_recap_seed");
    expect(createdJob?.status).toBe("brief_ready");
    expect(createdJob?.format).toBe("vertical_9_16");
    expect(createdJob?.duration_seconds).toBe(60);
    expect(createdJob?.scenes).toHaveLength(3);

    const history = await db
      .collection<HistoryDoc>(COLLECTIONS.history)
      .find({ trip_id: BOSTON_CREW_TRIP_ID, event_type: "video_job_created" })
      .toArray();
    expect(history).toHaveLength(1);
  });

  it("retrieves rated memories before preference-based recommendations", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      {
        kind: "tool_calls",
        calls: [
          {
            name: "search_semantic_memories",
            args: {
              trip_id: BOSTON_CREW_TRIP_ID,
              query: "quiet Tokyo route for cinematic video",
              rating_min: 4,
              limit: 3,
            },
          },
        ],
      },
      { kind: "text", text: "평점 높은 조용한 영상 루트를 기준으로 추천할게요." },
    ]);

    const trace = await runTurn({
      db,
      gemini,
      tripId: BOSTON_CREW_TRIP_ID,
      author: "seo",
      userText: "과거에 좋았던 취향 기반으로 조용한 영상 루트 추천해줘",
      ctx: {
        searchSemanticMemories: async () => [
          {
            _id: "mem_test_1",
            trip_id: BOSTON_CREW_TRIP_ID,
            user_handle: "seo",
            title: "Quiet Yoyogi morning walk",
            memory_text: "Rated 5. Quiet morning walk, good cinematic clips.",
            rating: 5,
            tags: ["quiet", "cinematic"],
            location: "Yoyogi Park, Tokyo",
            companions: ["seo", "jamie"],
            media_refs: ["asset_yoyogi_morning_01"],
            embedding_model: "test",
            created_at: "2026-05-01T12:00:00.000Z",
            score: 0.9,
          },
        ],
      },
    });

    expect(trace.calls.map((c) => c.name)).toEqual([
      "find_trip",
      "search_semantic_memories",
    ]);
    expect(trace.steps).toContainEqual({
      name: "search_semantic_memories",
      status: "completed",
      summary: "1 rated memories retrieved",
    });
  });
});
