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
  "video_job_created",
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

export const EventDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  title: z.string(),
  starts_at: ISODateTime,
  ends_at: ISODateTime.nullable(),
  location: z.string().nullable(),
  source: z.enum(["message", "ticket", "proposal", "seed"]),
  source_id: z.string(),
  status: z.enum(["open", "done", "skipped"]),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type EventDoc = z.infer<typeof EventDoc>;

export const TicketDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  member_handle: z.string(),
  type: z.enum(["flight", "hotel", "event", "receipt", "voucher", "reservation", "other"]),
  vendor: z.string(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  details_json: z.record(z.unknown()),
  pdf_url: z.string().url().nullable(),
  qr_data: z.string().nullable(),
  status: z.enum(["parsing", "parsed", "failed"]),
  starts_at: ISODateTime,
  ends_at: ISODateTime.nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  origin_latitude: z.number().nullable(),
  origin_longitude: z.number().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type TicketDoc = z.infer<typeof TicketDoc>;

export const ExpenseDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  payer: z.string(),
  amount: z.number().int().positive(),
  currency: z.string(),
  description: z.string(),
  split_among: z.array(z.string()).min(1),
  source: z.enum(["text", "receipt"]),
  receipt_url: z.string().url().nullable(),
  status: z.enum(["parsing", "parsed", "failed"]),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type ExpenseDoc = z.infer<typeof ExpenseDoc>;

export const PhotoDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  member_handle: z.string(),
  url: z.string().url(),
  taken_at: ISODateTime,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  caption: z.string().nullable(),
  place_name: z.string().nullable(),
  status: z.enum(["pending", "enriched", "failed"]),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type PhotoDoc = z.infer<typeof PhotoDoc>;

export const MediaAssetDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  member_handle: z.string(),
  kind: z.enum(["video"]),
  original_name: z.string(),
  mime_type: z.string(),
  file_url: z.string().url(),
  file_path: z.string(),
  duration_seconds: z.number().positive().nullable(),
  trim_start_seconds: z.number().nonnegative(),
  trim_duration_seconds: z.number().positive(),
  caption: z.string().nullable(),
  status: z.enum(["uploaded", "ready", "failed"]),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type MediaAssetDoc = z.infer<typeof MediaAssetDoc>;

export const VideoScene = z.object({
  id: z.string(),
  title: z.string(),
  source: z.enum(["decision", "message", "photo", "agent_memory"]),
  prompt: z.string(),
  duration_seconds: z.number().int().positive(),
  asset_refs: z.array(z.string()).default([]),
});
export type VideoScene = z.infer<typeof VideoScene>;

export const VideoJobDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  requested_by: z.string(),
  status: z.enum(["brief_ready", "rendering", "ready", "failed"]),
  format: z.enum(["vertical_9_16"]),
  duration_seconds: z.union([z.literal(60), z.literal(90), z.literal(120)]),
  title: z.string(),
  narrative: z.string(),
  scenes: z.array(VideoScene).min(1),
  output_url: z.string().url().nullable(),
  failure_reason: z.string().nullable(),
  created_at: ISODateTime,
  updated_at: ISODateTime,
});
export type VideoJobDoc = z.infer<typeof VideoJobDoc>;

export const TripMemoryDoc = z.object({
  _id: z.string(),
  trip_id: z.string(),
  user_handle: z.string(),
  title: z.string(),
  memory_text: z.string(),
  rating: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  location: z.string(),
  companions: z.array(z.string()),
  media_refs: z.array(z.string()),
  embedding: z.array(z.number()),
  embedding_model: z.string(),
  created_at: ISODateTime,
});
export type TripMemoryDoc = z.infer<typeof TripMemoryDoc>;

export const COLLECTIONS = {
  trips: "trips",
  members: "members",
  messages: "messages",
  proposals: "proposals",
  votes: "votes",
  history: "history",
  events: "events",
  tickets: "tickets",
  expenses: "expenses",
  photos: "photos",
  mediaAssets: "media_assets",
  videoJobs: "video_jobs",
  tripMemories: "trip_memories",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
