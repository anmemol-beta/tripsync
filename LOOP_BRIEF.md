# Trippo Agent — Overnight Loop Brief

> **For the autonomous loop:** This file is the source of truth for what to build.
> Each iteration: re-read this brief, check progress against success criteria, advance the weakest area.

---

## 0. Context (read first)

### What we're building
A re-conception of **Trippo** (group travel planning + recap product) as an **agent-first** application for the **Google Cloud Rapid Agent Hackathon**.

- Hackathon: https://devpost.com/ (Google Cloud Rapid Agent Hackathon)
- Deadline: **2026-06-11 17:00 EDT** (~31 days from 2026-05-11)
- Prize: $50,000 across 5 partner buckets ($5k/$3k/$2k per bucket)
- **Track we are entering: MongoDB** (1st $5k / 2nd $3k / 3rd $2k)
- Required stack: **Gemini 3** + **Google Cloud Agent Builder** + **MongoDB MCP server**
- Submission: hosted URL + public open-source repo (with LICENSE) + ~3 min demo video

### Critical context inversion (do NOT confuse)
Trippo was originally built for the **MindStudio Remy Hackathon (May 2026)** which **forbade chatbot/agent UX**. That product (in `~/Desktop/travel/travel-summary-app/`) was therefore designed with chat as a passive log + recap-video as the wow moment.

**This hackathon is the opposite:** the agent IS the product. Chat is the agent's UI. Multi-step tool use is the grading criterion. The recap-video angle is now secondary.

### Reference weighting
- `~/Desktop/travel/travel-summary-app/` — **REFERENCE ONLY, LOW WEIGHT.** Read for: data model intuition, demo scenario shape (Boston Crew), photo+EXIF flow, recap composition idea. Do NOT copy code structure (it's Remy/MindStudio-platform-bound).
- `~/Desktop/travel/remy-hackathon/notes/` — **REFERENCE ONLY, LOW WEIGHT.** Read `summary.md` for product evolution rationale.
- Everything else in the new repo must be designed fresh for Google Cloud Agent Builder + MongoDB MCP.

---

## 1. Product (one-liner)

**Trippo is an agent that plans group trips inside a chat your friends already use, with MongoDB as its shared memory.**

The agent:
1. Lives in a group chat room (web UI, mobile-friendly)
2. Receives natural-language messages from 2-5 friends planning a trip
3. **Plans, searches, proposes, and saves** trip artifacts (hotels, flights, activities, itinerary) as multi-step tool calls
4. Uses MongoDB MCP to persist + query trip state (proposals, votes, current plan, change history)
5. Keeps the group informed and lets humans decide — agent never auto-books without consensus

The differentiator: **shared multi-user state that the agent reads + writes + reasons over**. Solo travel agents exist; group-collaborative agents with persistent shared memory don't.

---

## 2. Hard success criteria (verifiable)

The loop is DONE when ALL of these are true. Verify each independently every iteration.

### 2.1 Documentation
- [ ] **`PRD.md`** exists, describes product + target user + competitive landscape + judging-criteria mapping
- [ ] **`ARCHITECTURE.md`** exists, shows: (frontend) ↔ (backend API) ↔ (Google Cloud Agent Builder agent) ↔ (MongoDB MCP) ↔ (MongoDB Atlas). Includes sequence diagram for one happy-path turn.
- [ ] **`MCP_INTEGRATION.md`** exists, lists each MongoDB MCP tool the agent will call, with example argument/return shapes
- [ ] **`AGENT_DESIGN.md`** exists, contains: system prompt draft, tool list, decision policy, human-in-the-loop checkpoints, refusal/escalation rules
- [ ] **`DEMO_SCENARIO.md`** exists, scripts a 3-minute demo (per hackathon submission requirement)
- [ ] **`MILESTONES.md`** exists, breaks down 5/11 → 6/11 into weekly chunks with verify-checks per milestone
- [ ] **`README.md`** exists at repo root, project intro + quickstart + LICENSE pointer
- [ ] **`LICENSE`** exists (MIT — hackathon requires open-source detectable license)

### 2.2 Scaffold
- [ ] `package.json` at root with chosen runtime (Node.js + TypeScript recommended — fastest path with Agent Builder REST + MongoDB driver)
- [ ] Folder structure:
  - `apps/web/` — frontend (Next.js or similar; mobile-first)
  - `apps/api/` — backend API (Express or Hono — proxies to Agent Builder, exposes chat endpoints)
  - `packages/agent/` — agent config: system prompt, tool definitions, MCP server hookup
  - `packages/schema/` — MongoDB collection schemas + TypeScript types
  - `packages/seed/` — Boston Crew seed data (port from `travel-summary-app/seeds/boston-trip/` but as MongoDB documents)
  - `docs/` — all the .md files from §2.1
- [ ] `.env.example` lists all required keys (GOOGLE_CLOUD_PROJECT, MONGODB_URI, etc.) — never commit real secrets
- [ ] `.gitignore` covers node_modules, .env, .next, dist, etc.

### 2.3 One happy path (working end-to-end with mocks where keys are missing)
**The happy path: "Friends ask for hotel, agent proposes, friends vote, agent saves winner."**

The path must run as code (with mock/stub where external keys aren't available — explicit `MOCK=true` env flag is fine):

1. POST `/chat` with message `"우리 도쿄 5/26-5/30 갈건데 시부야 근처 호텔 추천해줘. 예산 1박 15만원"` from user `alice`
2. Backend forwards to agent runtime
3. Agent calls `mongodb.find_trip({ trip_id })` → returns current trip context
4. Agent calls `external.search_hotels({ destination, dates, budget })` → returns 5 candidates (MOCK ok — return canned data when no API key)
5. Agent calls `mongodb.insert_proposal({ trip_id, type:'hotel', options: [...5] })`
6. Agent responds in chat: "5개 후보 올렸어요. 투표해주세요." with option cards
7. POST `/vote` with `{ proposal_id, option_idx: 2, voter:'bob' }`
8. Agent (next turn) calls `mongodb.tally_votes({ proposal_id })`, calls `mongodb.update_trip({ trip_id, set:{ hotel: option_2 } })`, calls `mongodb.append_history({ trip_id, event:'hotel_decided' })`
9. Agent responds: "시부야 그란벨로 결정됐어요. 변경 이력에 기록했습니다."

**Verify this path by:** an integration test (`pnpm test:happy-path` or `npm run test:happy-path`) that hits the API with the above sequence and asserts the MongoDB collections end up in the expected state. Use an in-memory MongoDB (e.g. `mongodb-memory-server`) so the test runs with zero external dependencies.

- [ ] Integration test exists, passes in CI-style command, asserts final MongoDB state
- [ ] README documents how to run the happy-path test in one command

### 2.4 Quality bars
- [ ] All TypeScript compiles (`tsc --noEmit` clean) — fix errors, do not suppress
- [ ] No `any` types in agent tool schemas (use Zod or similar for tool argument validation)
- [ ] Commit history is clean and atomic (no "wip" commits; each commit has a meaningful message)
- [ ] No real secrets committed (check `.env`, `.env.local` are in `.gitignore`)

### 2.5 Out of scope for the overnight loop
- Real Google Cloud Agent Builder deployment (needs user's GCP credentials)
- Real MongoDB Atlas connection (needs user's MongoDB URI)
- Real Gemini 3 API calls (needs user's API key)
- Real frontend visual polish (basic chat UI with one happy path is enough; design comes later)
- Photo/EXIF/recap-video pipeline (port from Remy in week 2-3, not tonight)
- Auth (mock user IDs are fine for the scaffold)

The loop should design and code as if these external services are available, with clean interfaces, mock implementations, and `TODO(real-key)` markers where keys are needed.

---

## 3. Plan (multi-step, verify after each step)

### Step 1 — Research + Reference scan
- Read `~/Desktop/travel/travel-summary-app/.trippo-spec.md`, `plan.md`, `seeds/boston-trip/` listing
- Read `~/Desktop/travel/remy-hackathon/notes/summary.md`
- Web-search: "Google Cloud Agent Builder MCP server integration site:cloud.google.com" and "MongoDB MCP server tools list"
- Verify: write findings to `docs/RESEARCH_NOTES.md`

### Step 2 — PRD + Architecture
- Write `docs/PRD.md` and `docs/ARCHITECTURE.md`
- Verify: an outsider reading PRD.md alone should be able to explain the product, why it wins MongoDB track, and what each judging criterion maps to

### Step 3 — MCP integration + Agent design
- Write `docs/MCP_INTEGRATION.md` and `docs/AGENT_DESIGN.md`
- Verify: every tool the agent calls in the happy path (§2.3) appears in MCP_INTEGRATION.md with shape; system prompt in AGENT_DESIGN.md covers the happy path

### Step 4 — Repo scaffold
- Create `apps/`, `packages/` per §2.2
- Write `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`, `LICENSE` (MIT), `README.md`
- Verify: `npm install` succeeds; `tsc --noEmit` succeeds (empty repo allowed)

### Step 5 — MongoDB schema
- Design collections in `packages/schema/`: `trips`, `members`, `messages`, `proposals`, `votes`, `decisions`, `history`
- Use Zod schemas + derived TypeScript types
- Verify: `tsc --noEmit` passes; sample document fixtures in `packages/schema/__fixtures__/` validate

### Step 6 — Agent runtime (with mocks)
- `packages/agent/` contains agent loop: receive message → call Gemini (mockable) → execute tool calls → reply
- Tool implementations call MongoDB via the driver directly (the "MCP" abstraction is the tool surface — actual MCP server wiring is for production deploy)
- Verify: unit tests for each tool

### Step 7 — Backend API
- `apps/api/` exposes `POST /chat`, `POST /vote`, `GET /trip/:id`
- Wires user message → agent → response
- Verify: integration test for happy path passes

### Step 8 — Frontend stub
- `apps/web/` minimal chat UI (single-page is fine for now)
- Verify: can render a chat thread + send a message + display agent response (mock)

### Step 9 — Demo scenario doc
- Write `docs/DEMO_SCENARIO.md`: 3-min video script with timestamps
- Verify: aligns with happy path; mentions MongoDB MCP integration

### Step 10 — Milestones + cleanup
- Write `docs/MILESTONES.md`: 31-day plan from 5/11 to 6/11
- Final commit, clean working tree

---

## 4. Constraints + style (Karpathy guidelines — strict)

1. **Simplicity First.** If a feature isn't in §2's success criteria, don't build it. No premature abstractions. No "future-proofing." 200 lines that solve it beats 800 lines of framework.
2. **No speculative tools or features.** Only the tools the happy path needs.
3. **Surgical Changes.** Each commit must be traceable to one success criterion.
4. **Strong typing.** No `any`. Zod for runtime, derived TS types for compile.
5. **Mockability.** External services (Gemini, MongoDB, hotel search) must be swappable behind an interface so tests run offline.
6. **No comments explaining what code does.** Only why (when non-obvious).
7. **No README/docs/comments in emoji.** No emoji in code or docs.
8. **No Co-Authored-By in commit messages.**

---

## 5. Loop self-check (at the start of each iteration)

1. Re-read this file (LOOP_BRIEF.md)
2. Check each [ ] in §2 — which are still unchecked?
3. Pick the highest-leverage unchecked item (usually: doc that unblocks next step, OR failing test)
4. Do that one thing. Verify. Commit.
5. If all of §2 checked → write `STATUS.md` with summary + open questions for the user, then exit loop
6. If stuck on the same item 2 iterations in a row → escalate by writing a question into `STATUS.md` and exit loop (don't spin)

---

## 6. Open questions the loop can decide on its own
- Frontend framework: pick Next.js (App Router) unless you find a reason not to
- Backend framework: pick Hono (lightweight, fast) unless you find a reason not to
- Package manager: pnpm
- TypeScript: yes, strict mode
- Test runner: vitest
- LICENSE: MIT
- MongoDB driver: official `mongodb` Node.js driver (not Mongoose)
- Validation: Zod
- Schema-to-types: `z.infer<>`

## 7. Open questions to leave for the user (write to STATUS.md, don't decide alone)
- Final product name (Trippo? or a new name reflecting the agent-pivot?)
- Whether to deploy frontend to Vercel/Cloud Run/Firebase Hosting
- MongoDB Atlas cluster region (depends on user's deploy region)
- Domain name / branding

---

## 8. References (filesystem paths)

- `~/Desktop/travel/travel-summary-app/.trippo-spec.md` — old product spec (Remy era)
- `~/Desktop/travel/travel-summary-app/plan.md` — old plan (Remy era)
- `~/Desktop/travel/travel-summary-app/seeds/boston-trip/` — seed data shape (port to MongoDB)
- `~/Desktop/travel/remy-hackathon/notes/summary.md` — product evolution history
- `~/Desktop/travel/trippo-demo-script.html` — old demo script HTML
- `~/.claude/CLAUDE.md` — user's coding guidelines (Karpathy-style; FOLLOW STRICTLY)
