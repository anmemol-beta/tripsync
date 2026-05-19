# Build loop backlog

Ordered task queue for the autonomous build loop. The loop does **one item per firing**, top-to-bottom, skipping `[blocked]` items.

**Status legend:** `[ ]` todo · `[~]` in progress (a firing claimed it) · `[x]` done · `[blocked: reason]` needs a human.

**Rules for the loop:** do only the named item. Every item is offline-safe (no external API keys, no live deploys). For items whose real version needs a key or a deployed service, write the code/config/docs behind a clean interface, mark `TODO(needs-user)` inline, and treat the item as done when the offline-writable part compiles + is tested. Never invent items — when all items are `[x]` or `[blocked]`, idle.

---

## Queue

### 1. `[blocked: pnpm test fails — network policy blocks fastdl.mongodb.org so mongodb-memory-server cannot download its binary; needs human to provide mongod or allow the download URL]` Flight decision type
Add `flight` as a working decision kind end-to-end, mirroring the hotel pattern. `search_flights` already has a stub returning `[]` — give it a `mockSearchFlights` (canned 5 candidates, like `mockSearchHotels`). Wire the full propose → vote → decide → history flow.
**Verify:** new `test/flight-path.test.ts` passes — propose flights → 3 votes → decide → `trips.decisions.flight` set, proposal `decided`, history row exists. `pnpm typecheck` + `pnpm test` green.

### 2. `[ ]` Activity decision type
Add `activity` as a working decision kind. Note: `decisions.activities` is an **array** — `update_trip_decision` already `$push`es for `kind:"activity"`. Give `search_activities` a `mockSearchActivities`. The flow allows multiple activity decisions on one trip.
**Verify:** new `test/activity-path.test.ts` — two separate activity proposals both decided, `trips.decisions.activities` has 2 entries. Green typecheck + test.

### 3. `[ ]` Edge-case test suite
New `test/edge-cases.test.ts` covering the policy in `AGENT_DESIGN.md` §3: (a) tie vote → `tally_votes.winner_option_id === null`; (b) quorum not met → `quorum_met === false`, `update_trip_decision` not called; (c) re-vote → same voter voting twice overwrites, vote count stays at distinct voters; (d) `insert_proposal` rejects a second open proposal of the same kind.
**Verify:** all 4 cases asserted, `pnpm test` green.

### 4. `[ ]` find_trip history read-back
`MCP_INTEGRATION.md` §2 says `find_trip` should let the agent reason over past decisions. Add a `get_trip_history` tool (or extend `find_trip`) that returns the last N `history` rows for a trip, so the agent can answer "우리 호텔 뭐로 정했었지".
**Verify:** test — after a decision, the tool returns the `decision_made` history row. Tool registered in `TOOL_NAMES`/`TOOL_SCHEMAS`. Green.

### 5. `[ ]` HITL: ambiguous-ask clarifying question
`AGENT_DESIGN.md` §4.1: when a hotel/flight/activity ask lacks dates or budget, the agent asks one clarifying question instead of searching. This is a prompt + flow behavior — add a test that scripts the mock Gemini to return a clarifying-question text turn (no tool calls) and asserts no `insert_proposal` happened.
**Verify:** test asserts `trace.calls` has no `search_*`/`insert_proposal` and `trace.reply` is a question. Green.

### 6. `[ ]` HITL: decision-change guard
`AGENT_DESIGN.md` §4.3: if `decisions.<kind>` is already set, the agent must surface the existing decision before opening a new proposal of the same kind. Add a test that scripts this and asserts the guard. If `insert_proposal`'s existing-open-proposal check needs extending to also consider decided kinds, do that in `runtime.ts`.
**Verify:** test — with a trip that already decided a hotel, a new hotel proposal attempt is gated. Green.

### 7. `[ ]` /trace endpoint + UI trace panel
`MILESTONES.md` Week 2 Day 5. Add `GET /trace/:trip_id` to `apps/api` returning the agent's tool calls grouped by turn (read from `messages` + a per-turn trace, or persist traces). Render it in `apps/web` as a side panel — the demo (`DEMO_SCENARIO.md`) leans on showing the tool trace live.
**Verify:** endpoint returns structured trace JSON; a test hits it after a happy-path turn. Web renders it (manual note in LOOP_LOG if UI can't be auto-verified). Green typecheck + test.

### 8. `[ ]` Next.js frontend upgrade
`apps/web` is a single `public/index.html` today. Upgrade to Next.js (App Router) per `MILESTONES.md` Week 3 — proper components for the chat thread, message bubble, vote buttons, trace panel. Keep it mobile-first. Do not add features beyond what the HTML stub already does plus the trace panel from item 7.
**Verify:** `pnpm --filter @tripsync/web build` succeeds. `pnpm typecheck` green. No new `any`.

### 9. `[ ]` VertexGeminiClient (write-only, untested)
Write `VertexGeminiClient` implementing the `GeminiClient` interface against Vertex AI's `generateContent` (Gemini 3, function calling, per-call `id` round-trip per `RESEARCH_NOTES.md` §3). Cannot be tested without `GOOGLE_AI_API_KEY` — mark `TODO(needs-user)` on the live call path. `MockGeminiClient` stays the default for tests.
**Verify:** file compiles (`pnpm typecheck` green), `GeminiClient` interface unchanged so the mock still satisfies it, all existing tests still green.

### 10. `[ ]` mongodb-mcp-server self-host config
Per `DECISIONS.md` #6 (self-hosted MCP transport). Add a `deploy/mcp/` folder: a `Dockerfile` for `mongodb-js/mongodb-mcp-server`, a Cloud Run service definition, and a `deploy/mcp/README.md` with the deploy steps. Do NOT deploy (needs GCP). Allow only `find`/`insert-one`/`update-one`/`aggregate` per `MCP_INTEGRATION.md` §3.
**Verify:** files exist and are internally consistent; README deploy steps are concrete. No code to typecheck — `pnpm test` still green (nothing broken).

### 11. `[ ]` MongoDB indices + schema validation
Add `packages/schema/src/indexes.ts` (or a setup script) that declares indices — `proposals` on `(trip_id, kind, status)`, `votes` unique on `(proposal_id, voter)`, `history` on `(trip_id, created_at)` — and applies them. Optionally JSON-schema collection validators derived from the Zod schemas.
**Verify:** a test creates the indices on an in-memory MongoDB and asserts the unique index rejects a duplicate `(proposal_id, voter)`. Green.

---

## Done log
(The loop moves completed items here with the firing date. Empty at start.)
