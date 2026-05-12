# Decisions log

Anything the team has locked in. Update with `## YYYY-MM-DD` sections, append-only. Old decisions stay; reversals get a new dated entry.

---

## 2026-05-12 — kickoff decisions

| # | Decision | Status | Notes |
|---|---|---|---|
| 1 | **Product name: Tripsync** | locked | Was "Trippo" during the Remy-era build. Renamed package scope `@trippo/*` → `@tripsync/*`; system prompt, README, docs, web title all updated in one rebrand commit. Repo directory `trippo-agent/` is intentionally left as-is (rename is friction; can do later). |
| 2 | **Deploy: Vercel (web) + Cloud Run (API)** | locked | Vercel for the Next.js frontend (zero-config, free tier ample). Cloud Run for the Hono API (same GCP project as Agent Builder + MongoDB MCP server). MongoDB Atlas region picked later (see #4). |
| 3 | **Team: shin-hu + Hyoungseo Son** | locked | Two-person team. Will divide work in `docs/MILESTONES.md` once Hyoungseo is onboarded — likely shin-hu on agent/runtime/MongoDB, Hyoungseo on frontend/demo. Add GitHub collaborator after the repo is pushed. |
| 4 | **MongoDB Atlas region** | deferred | Decide when we know where the demo recording happens (KR → AWS Seoul; US live judge → AWS us-east-1). Doesn't block week-1 work; in-memory MongoDB covers all local testing. |
| 5 | **Domain** | deferred | Decide just before the demo recording. Vercel preview URL is fine for testing. Candidates: `tripsync.app`, `tripsync.dev`. |
| 6 | **MCP transport: self-hosted `mongodb-mcp-server`** | locked | We deploy the official `mongodb-js/mongodb-mcp-server` on Cloud Run, point Vertex AI Agent Builder at it. Why not Google-managed MCP: MongoDB-managed MCP via Google is on the Cloud Next '26 roadmap but GA status unclear in May; self-hosted is safer + more visible in the 3-min demo (judges see "this is the MCP server I run"). |

---

## Pending decisions (not blocking)

- GitHub repo name + visibility (must be public per hackathon rules)
- License — locked as MIT in initial commit; can revisit if Hyoungseo prefers Apache-2.0
- Auth — not needed for the demo; defer to post-MVP
- Branding visuals (logo, color) — defer until name/domain settle
