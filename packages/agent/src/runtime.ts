import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type HistoryDoc,
  type MemberDoc,
  type ProposalDoc,
  type ProposalKind,
  type ProposalOption,
  type TripMemoryDoc,
  type TripDoc,
  type VideoJobDoc,
  type VoteDoc,
} from "@tripsync/schema";
import {
  AppendHistoryArgs,
  AppendVoteArgs,
  CreateTravelVideoArgs,
  FindTripArgs,
  InsertProposalArgs,
  ListMembersArgs,
  SearchActivitiesArgs,
  SearchFlightsArgs,
  SearchHotelsArgs,
  SearchSemanticMemoriesArgs,
  TallyVotesArgs,
  TOOL_SCHEMAS,
  UpdateTripDecisionArgs,
  type CreateTravelVideoArgs as CreateTravelVideoArgsType,
  type ToolName,
} from "./tools.js";
import type { MongoMcpClient } from "./mcp.js";

type ISO = string;

const isoNow = (): ISO => new Date().toISOString();
const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export type ToolContext = {
  db: Db;
  now: () => ISO;
  mcp?: MongoMcpClient;
  mcpDatabase?: string;
  searchHotels?: (args: SearchHotelsArgs) => Promise<ProposalOption[]>;
  searchFlights?: (args: SearchFlightsArgs) => Promise<ProposalOption[]>;
  searchActivities?: (args: SearchActivitiesArgs) => Promise<ProposalOption[]>;
  searchSemanticMemories?: (args: SearchSemanticMemoriesArgs) => Promise<SemanticMemoryResult[]>;
  embedText?: (text: string, taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT") => Promise<number[]>;
  vectorSearchIndex?: string;
};

const mcpDatabase = (ctx: ToolContext): string => ctx.mcpDatabase ?? ctx.db.databaseName;

export function mockSearchHotels(args: SearchHotelsArgs): ProposalOption[] {
  const budget = args.max_price_per_night_krw ?? 200000;
  const dest = args.destination;
  return [
    {
      id: "h_shibuya_grandvel",
      label: "Shibuya Grandvel Hotel",
      detail: {
        area: `${dest} — Shibuya`,
        price_per_night_krw: Math.min(140000, budget),
        rating: 4.4,
        amenities: ["breakfast", "wifi"],
        walk_to_station_min: 3,
      },
    },
    {
      id: "h_shinjuku_granbell",
      label: "Shinjuku Granbell Hotel",
      detail: {
        area: `${dest} — Shinjuku`,
        price_per_night_krw: Math.min(120000, budget),
        rating: 4.1,
        amenities: ["wifi"],
        walk_to_station_min: 6,
      },
    },
    {
      id: "h_shibuya_tokyu_stay",
      label: "Tokyu Stay Shibuya",
      detail: {
        area: `${dest} — Shibuya`,
        price_per_night_krw: Math.min(135000, budget),
        rating: 4.3,
        amenities: ["laundry", "wifi"],
        walk_to_station_min: 4,
      },
    },
    {
      id: "h_harajuku_park",
      label: "Park Hyatt Harajuku-side",
      detail: {
        area: `${dest} — Harajuku`,
        price_per_night_krw: Math.min(149000, budget),
        rating: 4.6,
        amenities: ["breakfast", "wifi", "gym"],
        walk_to_station_min: 8,
      },
    },
    {
      id: "h_shibuya_excel",
      label: "Shibuya Excel Tokyu",
      detail: {
        area: `${dest} — Shibuya`,
        price_per_night_krw: Math.min(145000, budget),
        rating: 4.5,
        amenities: ["breakfast", "wifi"],
        walk_to_station_min: 1,
      },
    },
  ];
}

export async function findTrip(ctx: ToolContext, raw: unknown): Promise<TripDoc> {
  const args = FindTripArgs.parse(raw);
  if (ctx.mcp) {
    const docs = await ctx.mcp.find<TripDoc>(
      mcpDatabase(ctx),
      COLLECTIONS.trips,
      { _id: args.trip_id },
      { limit: 1 },
    );
    const doc = docs[0];
    if (!doc) throw new Error(`trip not found: ${args.trip_id}`);
    return doc;
  }
  const doc = await ctx.db
    .collection<TripDoc>(COLLECTIONS.trips)
    .findOne({ _id: args.trip_id });
  if (!doc) throw new Error(`trip not found: ${args.trip_id}`);
  return doc;
}

export async function listMembers(ctx: ToolContext, raw: unknown): Promise<MemberDoc[]> {
  const args = ListMembersArgs.parse(raw);
  if (ctx.mcp) {
    return ctx.mcp.find<MemberDoc>(mcpDatabase(ctx), COLLECTIONS.members, {
      trip_id: args.trip_id,
    });
  }
  return ctx.db
    .collection<MemberDoc>(COLLECTIONS.members)
    .find({ trip_id: args.trip_id })
    .toArray();
}

export async function searchHotels(ctx: ToolContext, raw: unknown): Promise<ProposalOption[]> {
  const args = SearchHotelsArgs.parse(raw);
  if (ctx.searchHotels) return ctx.searchHotels(args);
  return mockSearchHotels(args);
}

export async function searchFlights(ctx: ToolContext, raw: unknown): Promise<ProposalOption[]> {
  const args = SearchFlightsArgs.parse(raw);
  if (ctx.searchFlights) return ctx.searchFlights(args);
  return [];
}

export async function searchActivities(
  ctx: ToolContext,
  raw: unknown,
): Promise<ProposalOption[]> {
  const args = SearchActivitiesArgs.parse(raw);
  if (ctx.searchActivities) return ctx.searchActivities(args);
  return [];
}

export type SemanticMemoryResult = Omit<TripMemoryDoc, "embedding"> & { score?: number };

export async function searchSemanticMemories(
  ctx: ToolContext,
  raw: unknown,
): Promise<SemanticMemoryResult[]> {
  const args = SearchSemanticMemoriesArgs.parse(raw);
  if (ctx.searchSemanticMemories) return ctx.searchSemanticMemories(args);
  if (!ctx.embedText) throw new Error("semantic memory search requires embedText");

  const queryVector = await ctx.embedText(args.query, "RETRIEVAL_QUERY");
  const pipeline = [
    {
      $vectorSearch: {
        index: ctx.vectorSearchIndex ?? "trip_memories_vector",
        path: "embedding",
        queryVector,
        numCandidates: Math.max(args.limit * 10, 50),
        limit: args.limit,
        filter: { trip_id: args.trip_id },
      },
    },
    { $match: { rating: { $gte: args.rating_min } } },
    {
      $project: {
        embedding: 0,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  if (ctx.mcp) {
    return ctx.mcp.aggregate<SemanticMemoryResult>(
      mcpDatabase(ctx),
      COLLECTIONS.tripMemories,
      pipeline,
    );
  }
  return ctx.db
    .collection<TripMemoryDoc>(COLLECTIONS.tripMemories)
    .aggregate<SemanticMemoryResult>(pipeline)
    .toArray();
}

export async function insertProposal(
  ctx: ToolContext,
  raw: unknown,
): Promise<{ proposal_id: string }> {
  const args = InsertProposalArgs.parse(raw);
  const existing = ctx.mcp
    ? (
        await ctx.mcp.find<ProposalDoc>(mcpDatabase(ctx), COLLECTIONS.proposals, {
          trip_id: args.trip_id,
          kind: args.kind,
          status: "open",
        }, { limit: 1 })
      )[0]
    : await ctx.db.collection<ProposalDoc>(COLLECTIONS.proposals).findOne({
        trip_id: args.trip_id,
        kind: args.kind,
        status: "open",
      });
  if (existing) throw new Error(`open proposal already exists for kind=${args.kind}`);
  const doc: ProposalDoc = {
    _id: newId("prop"),
    trip_id: args.trip_id,
    proposed_by: args.proposed_by,
    kind: args.kind,
    prompt_summary: args.prompt_summary,
    options: args.options,
    status: "open",
    created_at: ctx.now(),
  };
  if (ctx.mcp) {
    await ctx.mcp.insertOne(mcpDatabase(ctx), COLLECTIONS.proposals, doc);
  } else {
    await ctx.db.collection<ProposalDoc>(COLLECTIONS.proposals).insertOne(doc);
  }
  return { proposal_id: doc._id };
}

export async function appendVote(ctx: ToolContext, raw: unknown): Promise<{ vote_id: string }> {
  const args = AppendVoteArgs.parse(raw);
  const proposal = ctx.mcp
    ? (
        await ctx.mcp.find<ProposalDoc>(
          mcpDatabase(ctx),
          COLLECTIONS.proposals,
          { _id: args.proposal_id },
          { limit: 1 },
        )
      )[0]
    : await ctx.db
        .collection<ProposalDoc>(COLLECTIONS.proposals)
        .findOne({ _id: args.proposal_id });
  if (!proposal) throw new Error(`proposal not found: ${args.proposal_id}`);
  if (!proposal.options.some((o) => o.id === args.option_id)) {
    throw new Error(`option_id not in proposal: ${args.option_id}`);
  }
  const id = newId("vote");
  const update = {
      $set: {
        proposal_id: args.proposal_id,
        voter: args.voter,
        option_id: args.option_id,
        created_at: ctx.now(),
      },
      $setOnInsert: { _id: id },
    };
  if (ctx.mcp) {
    await ctx.mcp.updateMany(
      mcpDatabase(ctx),
      COLLECTIONS.votes,
      { proposal_id: args.proposal_id, voter: args.voter },
      update,
      true,
    );
  } else {
    await ctx.db.collection<VoteDoc>(COLLECTIONS.votes).updateOne(
      { proposal_id: args.proposal_id, voter: args.voter },
      update,
      { upsert: true },
    );
  }
  return { vote_id: id };
}

export type TallyResult = {
  proposal_id: string;
  total_voters: number;
  by_option: Array<{ option_id: string; count: number; voters: string[] }>;
  winner_option_id: string | null;
  quorum_met: boolean;
};

export async function tallyVotes(ctx: ToolContext, raw: unknown): Promise<TallyResult> {
  const args = TallyVotesArgs.parse(raw);
  const proposal = ctx.mcp
    ? (
        await ctx.mcp.find<ProposalDoc>(
          mcpDatabase(ctx),
          COLLECTIONS.proposals,
          { _id: args.proposal_id },
          { limit: 1 },
        )
      )[0]
    : await ctx.db
        .collection<ProposalDoc>(COLLECTIONS.proposals)
        .findOne({ _id: args.proposal_id });
  if (!proposal) throw new Error(`proposal not found: ${args.proposal_id}`);

  const pipeline = [
      { $match: { proposal_id: args.proposal_id } },
      { $group: { _id: "$option_id", count: { $sum: 1 }, voters: { $addToSet: "$voter" } } },
    ];
  const grouped = ctx.mcp
    ? await ctx.mcp.aggregate<{ _id: string; count: number; voters: string[] }>(
        mcpDatabase(ctx),
        COLLECTIONS.votes,
        pipeline,
      )
    : await ctx.db
        .collection<VoteDoc>(COLLECTIONS.votes)
        .aggregate<{ _id: string; count: number; voters: string[] }>(pipeline)
        .toArray();

  const totalVoters = grouped.reduce((acc, g) => acc + g.voters.length, 0);
  const memberCount = ctx.mcp
    ? await ctx.mcp.count(mcpDatabase(ctx), COLLECTIONS.members, { trip_id: proposal.trip_id })
    : await ctx.db
        .collection<MemberDoc>(COLLECTIONS.members)
        .countDocuments({ trip_id: proposal.trip_id });
  const quorum = Math.ceil(memberCount / 2);

  let winner: string | null = null;
  if (grouped.length > 0) {
    const top = [...grouped].sort((a, b) => b.count - a.count);
    const firstCount = top[0]?.count ?? 0;
    const tied = top.filter((g) => g.count === firstCount);
    winner = tied.length === 1 ? (top[0]?._id ?? null) : null;
  }

  return {
    proposal_id: args.proposal_id,
    total_voters: totalVoters,
    by_option: grouped.map((g) => ({ option_id: g._id, count: g.count, voters: g.voters })),
    winner_option_id: winner,
    quorum_met: totalVoters >= quorum && memberCount > 0,
  };
}

export async function updateTripDecision(
  ctx: ToolContext,
  raw: unknown,
): Promise<{ matched: number; modified: number }> {
  const args = UpdateTripDecisionArgs.parse(raw);
  const proposal = ctx.mcp
    ? (
        await ctx.mcp.find<ProposalDoc>(
          mcpDatabase(ctx),
          COLLECTIONS.proposals,
          { _id: args.proposal_id },
          { limit: 1 },
        )
      )[0]
    : await ctx.db
        .collection<ProposalDoc>(COLLECTIONS.proposals)
        .findOne({ _id: args.proposal_id });
  if (!proposal) throw new Error(`proposal not found: ${args.proposal_id}`);
  if (proposal.kind !== args.kind) {
    throw new Error(`proposal kind mismatch: ${proposal.kind} vs ${args.kind}`);
  }
  const winner = proposal.options.find((o) => o.id === args.winner_option_id);
  if (!winner) throw new Error(`winner option not in proposal: ${args.winner_option_id}`);

  const setOps =
    args.kind === "activity"
      ? { updated_at: ctx.now() }
      : { [`decisions.${args.kind}`]: winner, updated_at: ctx.now() };
  const pushOps =
    args.kind === "activity" ? { "decisions.activities": winner } : undefined;

  const updateDoc: Record<string, unknown> = { $set: setOps };
  if (pushOps) updateDoc["$push"] = pushOps;

  const res = ctx.mcp
    ? await ctx.mcp.updateMany(mcpDatabase(ctx), COLLECTIONS.trips, { _id: args.trip_id }, updateDoc)
    : await ctx.db
        .collection<TripDoc>(COLLECTIONS.trips)
        .updateOne({ _id: args.trip_id }, updateDoc);

  if (ctx.mcp) {
    await ctx.mcp.updateMany(
      mcpDatabase(ctx),
      COLLECTIONS.proposals,
      { _id: args.proposal_id },
      { $set: { status: "decided" } },
    );
  } else {
    await ctx.db
      .collection<ProposalDoc>(COLLECTIONS.proposals)
      .updateOne({ _id: args.proposal_id }, { $set: { status: "decided" } });
  }

  return { matched: res.matchedCount, modified: res.modifiedCount };
}

export async function appendHistory(
  ctx: ToolContext,
  raw: unknown,
): Promise<{ history_id: string }> {
  const args = AppendHistoryArgs.parse(raw);
  const doc: HistoryDoc = {
    _id: newId("hist"),
    trip_id: args.trip_id,
    event_type: args.event_type,
    actor: args.actor,
    payload: args.payload,
    created_at: ctx.now(),
  };
  if (ctx.mcp) {
    await ctx.mcp.insertOne(mcpDatabase(ctx), COLLECTIONS.history, doc);
  } else {
    await ctx.db.collection<HistoryDoc>(COLLECTIONS.history).insertOne(doc);
  }
  return { history_id: doc._id };
}

export async function createTravelVideo(
  ctx: ToolContext,
  raw: unknown,
): Promise<{ video_job_id: string; status: VideoJobDoc["status"] }> {
  const args: CreateTravelVideoArgsType = CreateTravelVideoArgs.parse(raw);
  const trip = ctx.mcp
    ? (
        await ctx.mcp.find<TripDoc>(
          mcpDatabase(ctx),
          COLLECTIONS.trips,
          { _id: args.trip_id },
          { limit: 1 },
        )
      )[0]
    : await ctx.db
        .collection<TripDoc>(COLLECTIONS.trips)
        .findOne({ _id: args.trip_id });
  if (!trip) throw new Error(`trip not found: ${args.trip_id}`);

  const now = ctx.now();
  const doc: VideoJobDoc = {
    _id: newId("video"),
    trip_id: args.trip_id,
    requested_by: args.requested_by,
    status: "brief_ready",
    format: "vertical_9_16",
    duration_seconds: args.duration_seconds,
    title: `${trip.title} recap`,
    narrative: args.narrative,
    scenes: args.scenes.map((scene, index) => ({
      id: `scene_${index + 1}`,
      title: scene.title,
      source: scene.source,
      prompt: scene.prompt,
      duration_seconds: scene.duration_seconds,
      asset_refs: scene.asset_refs,
    })),
    output_url: null,
    failure_reason: null,
    created_at: now,
    updated_at: now,
  };
  if (ctx.mcp) {
    await ctx.mcp.insertOne(mcpDatabase(ctx), COLLECTIONS.videoJobs, doc);
  } else {
    await ctx.db.collection<VideoJobDoc>(COLLECTIONS.videoJobs).insertOne(doc);
  }
  return { video_job_id: doc._id, status: doc.status };
}

export type ToolImpl = (ctx: ToolContext, args: unknown) => Promise<unknown>;

export const TOOLS: Record<ToolName, ToolImpl> = {
  find_trip: findTrip,
  list_members: listMembers,
  search_hotels: searchHotels,
  search_flights: searchFlights,
  search_activities: searchActivities,
  search_semantic_memories: searchSemanticMemories,
  insert_proposal: insertProposal,
  append_vote: appendVote,
  tally_votes: tallyVotes,
  update_trip_decision: updateTripDecision,
  append_history: appendHistory,
  create_travel_video: createTravelVideo,
};

// Re-export to keep ToolName + TOOL_SCHEMAS consistent at the boundary.
export { TOOL_SCHEMAS };

export const _internal = { isoNow, newId };
