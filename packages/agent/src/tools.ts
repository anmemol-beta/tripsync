import { z } from "zod";
import { ProposalKind, ProposalOption } from "@tripsync/schema";

export const FindTripArgs = z.object({ trip_id: z.string() });
export type FindTripArgs = z.infer<typeof FindTripArgs>;

export const ListMembersArgs = z.object({ trip_id: z.string() });
export type ListMembersArgs = z.infer<typeof ListMembersArgs>;

export const SearchHotelsArgs = z.object({
  destination: z.string(),
  check_in: z.string(),
  check_out: z.string(),
  max_price_per_night_krw: z.number().int().positive().nullable(),
  preferences: z.array(z.string()).default([]),
});
export type SearchHotelsArgs = z.infer<typeof SearchHotelsArgs>;

export const SearchFlightsArgs = z.object({
  from: z.string(),
  to: z.string(),
  depart_date: z.string(),
  return_date: z.string(),
  max_price_krw: z.number().int().positive().nullable(),
});
export type SearchFlightsArgs = z.infer<typeof SearchFlightsArgs>;

export const SearchActivitiesArgs = z.object({
  destination: z.string(),
  themes: z.array(z.string()).default([]),
  max_price_krw: z.number().int().nonnegative().nullable(),
});
export type SearchActivitiesArgs = z.infer<typeof SearchActivitiesArgs>;

export const SearchSemanticMemoriesArgs = z.object({
  trip_id: z.string(),
  query: z.string(),
  limit: z.number().int().positive().max(10).default(5),
  rating_min: z.number().int().min(1).max(5).default(4),
});
export type SearchSemanticMemoriesArgs = z.infer<typeof SearchSemanticMemoriesArgs>;

export const InsertProposalArgs = z.object({
  trip_id: z.string(),
  proposed_by: z.string(),
  kind: ProposalKind,
  prompt_summary: z.string(),
  options: z.array(ProposalOption).min(1),
});
export type InsertProposalArgs = z.infer<typeof InsertProposalArgs>;

export const AppendVoteArgs = z.object({
  proposal_id: z.string(),
  voter: z.string(),
  option_id: z.string(),
});
export type AppendVoteArgs = z.infer<typeof AppendVoteArgs>;

export const TallyVotesArgs = z.object({ proposal_id: z.string() });
export type TallyVotesArgs = z.infer<typeof TallyVotesArgs>;

export const UpdateTripDecisionArgs = z.object({
  trip_id: z.string(),
  proposal_id: z.string(),
  kind: ProposalKind,
  winner_option_id: z.string(),
});
export type UpdateTripDecisionArgs = z.infer<typeof UpdateTripDecisionArgs>;

export const AppendHistoryArgs = z.object({
  trip_id: z.string(),
  event_type: z.enum([
    "proposal_opened",
    "vote_cast",
    "decision_made",
    "decision_changed",
    "video_job_created",
    "agent_note",
  ]),
  actor: z.string(),
  payload: z.record(z.unknown()),
});
export type AppendHistoryArgs = z.infer<typeof AppendHistoryArgs>;

export const CreateTravelVideoArgs = z.object({
  trip_id: z.string(),
  requested_by: z.string(),
  duration_seconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).default(60),
  narrative: z.string(),
  scenes: z
    .array(
      z.object({
        title: z.string(),
        source: z.enum(["decision", "message", "photo", "agent_memory"]),
        prompt: z.string(),
        duration_seconds: z.number().int().positive(),
        asset_refs: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});
export type CreateTravelVideoArgs = z.infer<typeof CreateTravelVideoArgs>;

export const TOOL_NAMES = [
  "find_trip",
  "list_members",
  "search_hotels",
  "search_flights",
  "search_activities",
  "search_semantic_memories",
  "insert_proposal",
  "append_vote",
  "tally_votes",
  "update_trip_decision",
  "append_history",
  "create_travel_video",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_SCHEMAS = {
  find_trip: FindTripArgs,
  list_members: ListMembersArgs,
  search_hotels: SearchHotelsArgs,
  search_flights: SearchFlightsArgs,
  search_activities: SearchActivitiesArgs,
  search_semantic_memories: SearchSemanticMemoriesArgs,
  insert_proposal: InsertProposalArgs,
  append_vote: AppendVoteArgs,
  tally_votes: TallyVotesArgs,
  update_trip_decision: UpdateTripDecisionArgs,
  append_history: AppendHistoryArgs,
  create_travel_video: CreateTravelVideoArgs,
} as const;
