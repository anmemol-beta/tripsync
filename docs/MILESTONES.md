# Milestones — 5/11 → 6/11

31-day plan. Each week ends with a check that gates the next week.

---

## Week 0 — Overnight (5/11 → 5/12)

**Goal:** scaffolded repo with docs and a passing happy-path test against in-memory MongoDB and a mocked Gemini client.

- Docs (PRD, ARCHITECTURE, MCP_INTEGRATION, AGENT_DESIGN, DEMO_SCENARIO, MILESTONES, README)
- LICENSE (MIT), .gitignore, .env.example
- pnpm workspace + tsconfig + vitest
- packages/schema (Zod schemas for 6 collections)
- packages/seed (Boston Crew + Tokyo trip)
- packages/agent (mock Gemini, 10 tools, agent loop)
- apps/api (Hono, three endpoints)
- apps/web (Next.js stub, chat UI, vote buttons — minimal)
- Integration test `pnpm test:happy-path` green

**Verify:** `pnpm test:happy-path` exits 0. `pnpm typecheck` clean.

---

## Week 1 — Real services wired (5/13 → 5/19)

**Goal:** swap mocks for real services, deploy a hello-world to Cloud Run, prove the Agent Builder pipeline.

- Day 1: real MongoDB Atlas cluster + seed the Boston Crew + Tokyo trip into a fresh DB
- Day 2: real Gemini 3 client (`GOOGLE_AI_API_KEY`); run happy-path against real Gemini, mocked search still OK
- Day 3: deploy `apps/api` to Cloud Run (containerize, env vars wired)
- Day 4: deploy `apps/web` to Vercel (or Firebase Hosting — see open question)
- Day 5: register an Agent in Vertex AI Agent Builder console pointing at a hosted `mongodb-mcp-server`
- Day 6–7: rehearse the demo end-to-end on the deployed stack

**Verify:** demo flow works on the public URL with real Gemini + real Atlas.

---

## Week 2 — Real external search + observability (5/20 → 5/26)

**Goal:** replace mocked `search_hotels` etc. with real grounded search; add traces.

- Day 1–2: wire `search_hotels` to Google Maps grounding (built-in Gemini tool) instead of the mock array
- Day 3: same for `search_flights` (likely SerpAPI or Skyscanner partner; if no key, keep mock with `TODO(real-key)`)
- Day 4: `search_activities` — same approach as hotels
- Day 5: add a `/trace/:trip_id` endpoint that returns the agent's tool calls per turn, render in UI as a side panel
- Day 6–7: polish — error states, loading states, mobile responsiveness pass

**Verify:** a real user (not pre-scripted) can plan a trip end-to-end on a phone in ≤5 minutes.

---

## Week 3 — UX polish + demo recording (5/27 → 6/2)

**Goal:** make it look like a product, not a hack.

- Day 1–2: visual pass — typography, spacing, colors, avatar bubbles, vote buttons
- Day 3: mobile breakpoints (375/390/412 widths)
- Day 4: write the pitch deck (separate Google Slides)
- Day 5: shoot the 3-min demo video per `docs/DEMO_SCENARIO.md`
- Day 6: shoot the backup 90-sec demo
- Day 7: edit + compress to ≤200MB (Devpost limit)

**Verify:** demo video plays back smoothly on a fresh browser; pitch deck reads cleanly.

---

## Week 4 — Submission + buffer (6/3 → 6/11)

**Goal:** submit cleanly with time to fix anything that breaks.

- Day 1–2: write the submission narrative (~500 words)
- Day 3: final security pass — no committed secrets, IAM tightened, MongoDB user has scoped permissions
- Day 4: open-source LICENSE final check; tag a `v0.1.0` release
- Day 5: submit to Devpost
- Day 6–8: buffer for any reviewer questions / fixes
- Day 8 (6/11): hackathon close at 17:00 EDT

**Verify:** Devpost submission accepted; live URL responding; repo public.

---

## Cross-cutting bars (every week)

- `pnpm typecheck` clean (no `any`)
- `pnpm test` green
- No real secrets in git history
- Atomic commits with meaningful messages
- README quickstart still works on a fresh clone

If any of these slips two weeks running, drop the lowest-priority feature for the week and re-stabilize.
