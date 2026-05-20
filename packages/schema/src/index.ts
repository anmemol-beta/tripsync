import { z } from "zod";

const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const ISODateTime = z.string().datetime({ offset: true });

export const HotelOptionDetail = z.object({
  area: z.string(),
  price_per_night_krw: z.number().int().positive(),
  rating: z.number().min(0).max(5),
  amenities: z.array(z.string()),
  walk_to_station_min: z.number().int().nonnegative(),
});
export type HotelOptionDetail = z.infer<typeof HotelOptionDetail>;

export const FlightOptionDetail = z.object({
  carrier: z.string(),
  flight_number: z.string(),
  depart_airport: z.string(),
  arrive_airport: z.string(),
  depart_at: ISODateTime,
  arrive_at: ISODateTime,
  price_krw: z.number().int().positive(),
});
export type FlightOptionDetail = z.infer<typeof FlightOptionDetail>;

export const ActivityOptionDetail = z.object({
  name: z.string(),
  area: z.string(),
  price_krw: z.number().int().nonnegative(),
  duration_min: z.number().int().positive(),
});
export type ActivityOptionDetail = z.infer<typeof ActivityOptionDetail>;

export const ProposalKind = z.enum(["hotel", "flight", "activity"]);
export type ProposalKind = z.infer<typeof ProposalKind>;

export const ProposalOption = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.record(z.unknown()),
});
export type ProposalOption = z.infer<typeof ProposalOption>;

export const TripDoc = z.object({
  _id: z.string(),
  group_id: z.string(),
  title: z.string(),
  destination: z.string(),
  start_date: ISODate,
  end_date: ISODate,
  status: z.enum(["planning", "active", "ended"]),
  budget_krw_per_night: z.number().int().positive().nullable(),
  decisions: z.object({
    hotel: ProposalOption.nullable(),
    flight: ProposalOption.nullable(),
    activities: z.array(ProposalOption),
  }),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type TripDoc = z.infer<typeof TripDoc>;

export const MemberDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  user_handle: z.string(),
  display_name: z.string(),
  avatar_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  role: z.enum(["owner", "member"]),
});
export type MemberDoc = z.infer<typeof MemberDoc>;

export const MessageDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  author: z.string(), // user_handle or "agent"
  body: z.string(),
  created_at: ISODateTime,
});
export type MessageDoc = z.infer<typeof MessageDoc>;

export const ProposalDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  proposed_by: z.string(),
  kind: ProposalKind,
  prompt_summary: z.string(),
  options: z.array(ProposalOption).min(1),
  status: z.enum(["open", "decided", "cancelled"]),
  created_at: ISODateTime,
});
export type ProposalDoc = z.infer<typeof ProposalDoc>;

export const VoteDoc = z.object({
  _id: z.string(),
  proposal_id: z.string(),
  voter: z.string(),
  option_id: z.string(),
  created_at: ISODateTime,
});
export type VoteDoc = z.infer<typeof VoteDoc>;

export const HistoryEventType = z.enum([
  "proposal_opened",
  "vote_cast",
  "decision_made",
  "decision_changed",
  "agent_note",
]);
export type HistoryEventType = z.infer<typeof HistoryEventType>;

export const HistoryDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  event_type: HistoryEventType,
  actor: z.string(),
  payload: z.record(z.unknown()),
  created_at: ISODateTime,
});
export type HistoryDoc = z.infer<typeof HistoryDoc>;

export const TraceCallEntry = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.unknown()),
});
export type TraceCallEntry = z.infer<typeof TraceCallEntry>;

export const TraceDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  calls: z.array(TraceCallEntry),
  reply: z.string(),
  created_at: ISODateTime,
});
export type TraceDoc = z.infer<typeof TraceDoc>;

export const COLLECTIONS = {
  trips: "trips",
  members: "members",
  messages: "messages",
  proposals: "proposals",
  votes: "votes",
  history: "history",
  traces: "traces",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export { applyIndexes } from "./indexes.js";
