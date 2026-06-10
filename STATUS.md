# Overnight Loop — Status

Last update: 2026-05-11 (overnight loop finished).

---

## 2026-06-09 update

- Added `trip_memories` as rated past-trip memory documents with Vertex embeddings.
- Added `search_semantic_memories` as the agent tool for Atlas Vector Search retrieval.
- Added `pnpm seed:memories` and `pnpm smoke:vector` for real Atlas persistence/search verification.
- Mobile UI now has an agent activity timeline with running/completed/failed states and evidence summaries.

---

## TL;DR

All `LOOP_BRIEF.md` §2 success criteria are checked. `pnpm test:happy-path` exits 0 against in-memory MongoDB. Clean typecheck, no `any`, no committed secrets, 14 atomic commits.

**Current direction update:** Trippo Agent is now React/mobile-first, MongoDB-track-first, and recap-video-first. Mock Gemini is only for deterministic tests; real development runs must use Gemini credentials plus a real MongoDB URI so agent tool actions can be verified against persisted data.

---

## §2 success criteria — all checked

### §2.1 Documentation
- [x] `docs/PRD.md` — product, target user, MongoDB-track positioning, judging-criteria mapping
- [x] `docs/ARCHITECTURE.md` — component diagram + happy-path sequence diagram
- [x] `docs/MCP_INTEGRATION.md` — 10 domain tools with argument/return shapes
- [x] `docs/AGENT_DESIGN.md` — system prompt, decision policy, HITL checkpoints, refusal rules
- [x] `docs/DEMO_SCENARIO.md` — 3-minute video script with timestamps
- [x] `docs/MILESTONES.md` — 4-week plan 5/11 → 6/11
- [x] `README.md` — quickstart, layout, status
- [x] `LICENSE` — MIT
- [x] (bonus) `docs/RESEARCH_NOTES.md` — saved findings on GCP Agent Builder, MongoDB MCP, Gemini 3 so future iterations don't re-fetch

### §2.2 Scaffold
- [x] `package.json` at root (pnpm workspace, Node ≥ 20, TS, vitest)
- [x] `apps/web/` — Vite React mobile UI for chat, proposal voting, tool trace, and recap-video jobs
- [x] `apps/api/` — Hono server with `POST /chat`, `POST /vote`, `GET /trip/:id`
- [x] `packages/agent/` — Gemini interface (mockable), 10 tools, agent loop
- [x] `packages/schema/` — Zod schemas + `z.infer<>` types for 6 collections
- [x] `packages/seed/` — Boston Crew Tokyo trip fixture
- [x] `docs/` — all 7 docs above
- [x] `.env.example` — MOCK, MONGODB_URI, GOOGLE_CLOUD_PROJECT, GOOGLE_AI_API_KEY, PORT
- [x] `.gitignore` — node_modules, .env, .next, dist, .tsbuildinfo, etc.

### §2.3 Happy path
- [x] Integration test in `test/happy-path.test.ts` — 3 assertions:
  1. Agent proposes (`find_trip` → `search_hotels` → `insert_proposal` → `append_history`)
  2. Three vote writes land
  3. Agent decides (`tally_votes` → `update_trip_decision` → `append_history`), trip doc has `decisions.hotel.id = h_shibuya_excel`, proposal status flips to `decided`, history row exists
- [x] Runs via `pnpm test:happy-path` — zero external deps (uses `mongodb-memory-server`)
- [x] README documents the command

### §2.4 Quality bars
- [x] `tsc --noEmit` (via `tsc -b`) clean
- [x] Zero `any` types anywhere in `packages/`, `apps/`, `test/` (verified by grep)
- [x] 14 atomic commits, each traceable to one success criterion or one logical scaffold unit
- [x] No real secrets committed (.env in .gitignore; .env.example uses placeholders)

---

## What got built (concrete file list)

**Docs (8 files):** PRD.md, ARCHITECTURE.md, MCP_INTEGRATION.md, AGENT_DESIGN.md, DEMO_SCENARIO.md, MILESTONES.md, RESEARCH_NOTES.md, README.md.

**Schemas (`packages/schema/src/index.ts`):** Zod models for `TripDoc`, `MemberDoc`, `MessageDoc`, `ProposalDoc`, `VoteDoc`, `HistoryDoc`, plus `HotelOptionDetail` / `FlightOptionDetail` / `ActivityOptionDetail` for typed proposal payloads. Exports `COLLECTIONS` and `ProposalKind` enum.

**Agent (`packages/agent/`):**
- `gemini.ts` — `GeminiClient` interface, `MockGeminiClient` driven by a scripted plan
- `tools.ts` — Zod argument schemas for 10 tools; `TOOL_NAMES`, `TOOL_SCHEMAS` registries
- `runtime.ts` — Tool implementations against MongoDB driver (`find_trip`, `list_members`, `search_hotels` mock, `search_flights`/`search_activities` stubs, `insert_proposal`, `append_vote` upserting, `tally_votes` aggregation with quorum, `update_trip_decision` with proposal-status flip, `append_history`)
- `loop.ts` — Per-turn agent loop with `SYSTEM_PROMPT`, tool-hop limit, Zod validation, per-call error capture

**API (`apps/api/`):** Hono `buildApp(deps)` factory + `server.ts` entry point that connects to MongoDB and starts on `PORT`.

**Web (`apps/web/`):** Vite React mobile-first chat UI that calls `GET /trip/:id/state`, `POST /chat`, and `POST /vote`, then renders decisions, proposals, tool traces, and recap-video jobs.

**Test (`test/happy-path.test.ts`):** spins up `mongodb-memory-server`, seeds Boston Crew, runs two agent turns + three vote writes, asserts final MongoDB state.

---

## What's pending (Week 1+, not for tonight)

- **Real Gemini 3 client** — `GoogleGeminiClient` is wired behind `AGENT_PROVIDER=gemini`. It still needs a live credential run against Atlas to verify the exact function-calling payload shape end to end.
- **Real Atlas wiring** — `apps/api/src/server.ts` already reads `MONGODB_URI`. Hand it a real connection string.
- **Real Vertex AI Agent Builder hosting** — Register the agent with the system prompt + tool schemas (already documented in `docs/AGENT_DESIGN.md` §7). Point at a hosted `mongodb-mcp-server` (Atlas-connected) for the production MCP transport.
- **Real external search** — `search_hotels` returns canned data when `ctx.searchHotels` is unset. Swap to Maps Grounding (Gemini 3 built-in) or Google Places. `search_flights` and `search_activities` are stubs returning `[]` — same pattern.
- **React polish** — keep the Vite React app narrow and phone-first. Add only what the 3-minute demo needs.
- **Auth** — Mock user handles only. Real auth is post-MVP.
- **Travel video rendering** — the agent can now persist a `video_jobs` brief. The next adapter should turn that brief into a real 9:16 MP4 and update `output_url`.

---

## Open questions for the user (in priority order)

1. **Product name.** Stick with "Trippo" (carries the Remy-era brand) or pick something agent-native (e.g., "Tripsync", "Quorum", "Roomly")? Affects domain, logo, and the GitHub repo name.
2. **Frontend deploy target.** Vercel (zero-config Next.js, free tier ample) vs Cloud Run (same env as the API, single GCP project) vs Firebase Hosting (also same GCP project, free SSL). Recommend **Vercel for web + Cloud Run for API** to minimize friction. Confirm or push back.
3. **MongoDB Atlas region.** Pick a region close to the demo recording location. If recording from KR → AWS Seoul. If demoing live to US judges → AWS us-east-1.
4. **Domain.** Want to register one for the demo (e.g., `trippo.dev`, `trippo.app`)? Or just use the Vercel preview URL?
5. **Hackathon team.** Solo entry, or pulling anyone in? Affects how aggressively we can parallelize Weeks 2–3.
6. **MCP transport choice.** Devpost rules require "MongoDB MCP server" — should the demo connect via Google's managed MCP endpoint (when MongoDB ships as a managed server, which is on the Cloud Next '26 roadmap) or self-hosted `mongodb-mcp-server`? Self-hosted is safer and visible in the demo.

---

## Commands to run when you wake up

```bash
cd /Users/hunjunsin/Desktop/travel/trippo-agent

# 1. confirm clean install + green tests on a fresh shell
corepack enable pnpm
pnpm install
pnpm typecheck
pnpm test:happy-path

# 2. (optional) start the API + web locally with mock Gemini
#    note: requires a MongoDB locally; the test already proves the in-memory path
#    you can skip this until Week 1 atlas wiring
# MONGODB_URI=mongodb://localhost:27017/trippo pnpm --filter @trippo/api start
# pnpm --filter @trippo/web dev

# 3. read the docs in this order:
#    docs/PRD.md           (5 min — why we win)
#    docs/ARCHITECTURE.md  (5 min — how pieces fit)
#    docs/MILESTONES.md    (3 min — what to build next)
#    docs/AGENT_DESIGN.md  (10 min — the agent's brain)
#    docs/MCP_INTEGRATION.md (10 min — tool shapes)
#    docs/DEMO_SCENARIO.md (5 min — 3-min demo script)
#    docs/RESEARCH_NOTES.md (skim — saved sources)
```

---

## Loop self-assessment

- **Karpathy guideline 1 (Think Before Coding):** Where unclear I made the call and named it in commit messages (`workspace structure`, `mock Gemini interface`, `single-file web stub vs Next.js`). Open decisions deferred to user are listed above.
- **Karpathy guideline 2 (Simplicity First):** Web is a 100-line single-file HTML page, not a Next.js scaffold. Agent's mock client is 30 lines. Search is a canned array. Each is upgradeable in one file when the time comes.
- **Karpathy guideline 3 (Surgical Changes):** Every commit message names which §2 success criterion it advances. No drive-by refactors.
- **Karpathy guideline 4 (Goal-Driven):** The happy-path test is the single verifiable goal. It runs in <1s once mongodb-memory-server cache is warm. Every other piece of work was gated on advancing toward it.

No escalations needed — the loop met all §2 criteria within the time budget.
