import type { Db } from "mongodb";
import {
  COLLECTIONS,
  type MemberDoc,
  type MessageDoc,
  type TripDoc,
} from "@tripsync/schema";

export const BOSTON_CREW_TRIP_ID = "trip_tokyo_2026_05";
export const BOSTON_CREW_GROUP_ID = "grp_boston_crew";

const ISO_NOW = "2026-05-11T00:00:00-04:00";

const TRIP: TripDoc = {
  _id: BOSTON_CREW_TRIP_ID,
  group_id: BOSTON_CREW_GROUP_ID,
  title: "Tokyo 5/26-5/30",
  destination: "Tokyo, Japan",
  start_date: "2026-05-26",
  end_date: "2026-05-30",
  status: "planning",
  budget_krw_per_night: 150000,
  decisions: { hotel: null, flight: null, activities: [] },
  created_at: ISO_NOW,
  updated_at: ISO_NOW,
};

const MEMBERS: MemberDoc[] = [
  {
    _id: "mem_seo",
    trip_id: BOSTON_CREW_TRIP_ID,
    user_handle: "seo",
    display_name: "Seo",
    avatar_color: "#E07856",
    role: "owner",
  },
  {
    _id: "mem_jamie",
    trip_id: BOSTON_CREW_TRIP_ID,
    user_handle: "jamie",
    display_name: "Jamie",
    avatar_color: "#3B7A57",
    role: "member",
  },
  {
    _id: "mem_min",
    trip_id: BOSTON_CREW_TRIP_ID,
    user_handle: "min",
    display_name: "Min",
    avatar_color: "#7E5A9B",
    role: "member",
  },
];

const MESSAGES: MessageDoc[] = [
  {
    _id: "msg_001",
    trip_id: BOSTON_CREW_TRIP_ID,
    author: "seo",
    body: "다음 여행 도쿄로 정했어. 5/26-5/30 어때?",
    created_at: "2026-05-10T20:00:00-04:00",
  },
  {
    _id: "msg_002",
    trip_id: BOSTON_CREW_TRIP_ID,
    author: "jamie",
    body: "좋아 휴가 빼놨어",
    created_at: "2026-05-10T20:02:00-04:00",
  },
  {
    _id: "msg_003",
    trip_id: BOSTON_CREW_TRIP_ID,
    author: "min",
    body: "콜",
    created_at: "2026-05-10T20:03:00-04:00",
  },
];

export async function seedBostonCrew(db: Db): Promise<void> {
  await db.collection<TripDoc>(COLLECTIONS.trips).insertOne(TRIP);
  await db.collection<MemberDoc>(COLLECTIONS.members).insertMany(MEMBERS);
  await db.collection<MessageDoc>(COLLECTIONS.messages).insertMany(MESSAGES);
}

export const bostonCrewFixture = {
  trip: TRIP,
  members: MEMBERS,
  messages: MESSAGES,
};
