# MongoDB MCP Integration

How Tripsync's agent talks to MongoDB through the MCP server.

The agent does **not** see raw `find` / `insert-one` calls. It sees **domain tools** (e.g. `find_trip`, `insert_proposal`). Each domain tool is implemented in `packages/agent/src/tools/` as a thin wrapper that issues one or more MongoDB MCP primitive calls.

This split exists because:
- The LLM is more reliable with small, well-named tool schemas than with a generic `query(collection, filter)` knife.
- The MCP wire protocol stays standard, so production routing through the official `mongodb-mcp-server` works unchanged.
- Each tool can be unit-tested deterministically.

---

## 1. Tool surface (what the LLM sees)

| Tool | Purpose | MongoDB MCP primitive(s) used |
|---|---|---|
| `find_trip` | Load the current trip document by `trip_id`. | `find` on `trips` |
| `list_members` | Return the members of a trip (for vote-quorum reasoning). | `find` on `members` |
| `search_hotels` | External-search proxy. **Mocked tonight.** Returns 5 candidate hotels. | none (external) |
| `search_flights` | External-search proxy. Mocked. | none (external) |
| `search_activities` | External-search proxy. Mocked. | none (external) |
| `search_semantic_memories` | Retrieve high-rated similar trip memories for recommendations and video direction. | `aggregate` with `$vectorSearch` on `trip_memories` |
| `insert_proposal` | Persist a new proposal (hotel / flight / activity) with `options[]`. | `insert-one` on `proposals` |
| `append_vote` | Record one member's vote for one proposal option. | `insert-one` on `votes` |
| `tally_votes` | Aggregate vote counts per option for a proposal. | `aggregate` on `votes` |
| `update_trip_decision` | `$set` chosen winner onto `trips.decisions.<kind>`. | `update-one` on `trips` |
| `append_history` | Append a structured event to the trip change-log. | `insert-one` on `history` |
| `create_travel_video` | Persist the 9:16 recap-video brief/job with concrete scenes. | `insert-one` on `video_jobs` |

Total: 12 tools. The agent's system prompt names all 12 and gives one example per category.

---

## 2. Argument / return shapes

All argument schemas are Zod-validated at the boundary. Types below are `z.infer<>`.

### `find_trip`

```ts
// args
{ trip_id: string }

// returns
{
  _id: string;
  group_id: string;
  title: string;
  destination: string;
  start_date: string;   // ISO date
  end_date: string;     // ISO date
  status: "planning" | "active" | "ended";
  budget_krw_per_night: number | null;
  decisions: {
    hotel: HotelDecision | null;
    flight: FlightDecision | null;
    activities: ActivityDecision[];
  };
  created_at: string;   // ISO datetime
  updated_at: string;
}
```

### `list_members`

```ts
// args
{ trip_id: string }

// returns
Array<{
  _id: string;
  trip_id: string;
  user_handle: string;       // "alice", "bob", ...
  display_name: string;
  avatar_color: string;      // hex
  role: "owner" | "member";
}>
```

### `search_hotels` (mock)

```ts
// args
{
  destination: string;
  check_in: string;          // ISO date
  check_out: string;         // ISO date
  max_price_per_night_krw: number | null;
  preferences: string[];     // ["near_shibuya_station", "breakfast_included"]
}

// returns
Array<{
  id: string;                // mock id, e.g. "h_shibuya_grandvel"
  name: string;
  area: string;
  price_per_night_krw: number;
  rating: number;            // 0-5
  amenities: string[];
  walk_to_station_min: number;
}>
```

`MOCK=true` returns a canned 5-item list anchored on the user's destination string. Real version `TODO(real-key)` will swap to a Google Places / Maps Grounding call.

### `insert_proposal`

```ts
// args
{
  trip_id: string;
  proposed_by: string;        // member.user_handle
  kind: "hotel" | "flight" | "activity";
  prompt_summary: string;     // 1-line summary of the user's ask
  options: Array<{
    id: string;
    label: string;            // short human label
    detail: Record<string, unknown>; // raw card data (validated by kind)
  }>;
}

// returns
{ proposal_id: string }
```

### `append_vote`

```ts
// args
{
  proposal_id: string;
  voter: string;              // user_handle
  option_id: string;
}

// returns
{ vote_id: string }
```

Idempotent on (`proposal_id`, `voter`) — a second vote from the same voter overwrites the first.

### `tally_votes`

```ts
// args
{ proposal_id: string }

// returns
{
  proposal_id: string;
  total_voters: number;       // distinct voters who cast a vote
  by_option: Array<{
    option_id: string;
    count: number;
    voters: string[];
  }>;
  winner_option_id: string | null;   // null if tie or zero votes
  quorum_met: boolean;        // count(distinct voters) >= ceil(member_count / 2)
}
```

Backed by `aggregate` with `$group` on `option_id` then a `$lookup` on `members` for quorum.

### `update_trip_decision`

```ts
// args
{
  trip_id: string;
  proposal_id: string;
  kind: "hotel" | "flight" | "activity";
  winner_option_id: string;
}

// returns
{ matched: number; modified: number }
```

### `append_history`

```ts
// args
{
  trip_id: string;
  event_type: "proposal_opened" | "vote_cast" | "decision_made" | "decision_changed" | "video_job_created" | "agent_note";
  actor: string;              // "alice" or "agent"
  payload: Record<string, unknown>;
}

// returns
{ history_id: string }
```

History rows are append-only. The agent reads back via `find_trip` (which $lookup-joins the latest N history entries) — that read pattern is also unit-tested.

### `create_travel_video`

```ts
// args
{
  trip_id: string;
  requested_by: string;
  duration_seconds: 60 | 180 | 300;
  narrative: string;
  scenes: Array<{
    title: string;
    source: "decision" | "message" | "photo" | "agent_memory";
    prompt: string;
    duration_seconds: number;
    asset_refs: string[];
  }>;
}

// returns
{ video_job_id: string; status: "brief_ready" | "rendering" | "ready" | "failed" }
```

The render adapter is intentionally separate. This tool proves the agent can transform MongoDB trip memory into a concrete video plan and persist it for the production renderer.

---

## 3. Production wiring (out of scope for tonight, doc only)

In Vertex AI Agent Builder console:
1. Register a remote MCP server pointing at our hosted `mongodb-mcp-server` instance (Atlas-connected).
2. Allow the 4 MCP primitives we use: `find`, `insert-one`, `update-one`, `aggregate`. Deny the rest.
3. Bind the agent's tool descriptors (the 10 above) to thin adapter functions that translate domain args into the primitives. The adapters live alongside the agent definition in Agent Builder, so the prompt + tool spec ship together.

For the hackathon submission video, we point at a live Atlas cluster from the Agent Builder console and walk through the same happy path as the offline test.

---

## 4. Failure modes the agent must handle

| Failure | Detection | Agent reaction |
|---|---|---|
| `find_trip` returns null | trip_id not found | Apologize, ask user to create trip first. Do not invent a trip. |
| `tally_votes.quorum_met = false` | <half members voted | Reply with current standings, do NOT call `update_trip`. |
| `search_hotels` returns 0 items | empty array | Ask user to relax budget or change area. Do not fabricate options. |
| MongoDB MCP unreachable | tool throws | Surface "메모리에 접근하지 못했어요. 잠시 후 다시 시도해주세요." and stop the loop. |

These are encoded as decision-policy lines in `docs/AGENT_DESIGN.md`.
