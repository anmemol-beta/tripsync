# trippo-agent

Group travel planning agent for the **Google Cloud Rapid Agent Hackathon (MongoDB track)**.

Built with **Gemini 3** + **Vertex AI Agent Builder** + **MongoDB MCP**.

The agent lives in a chat room shared by 2–5 friends. It plans, proposes, polls, decides, and persists trip artifacts to MongoDB — its shared memory. Take MongoDB out and the agent forgets who voted and what was decided.

See [`LOOP_BRIEF.md`](./LOOP_BRIEF.md) for the build brief and [`docs/`](./docs) for the full design.

---

## Quickstart

Requires Node ≥ 20 and pnpm (auto-installed via Corepack).

```bash
corepack enable pnpm
pnpm install
pnpm typecheck
pnpm test:happy-path     # full agent-loop integration test, in-memory MongoDB
```

`pnpm test:happy-path` runs the canonical scenario from `docs/DEMO_SCENARIO.md`: the agent proposes hotels, three members vote, the agent tallies the vote, persists the winner, and appends a change-log entry. All against an in-memory MongoDB. No external keys needed.

## Layout

```
apps/
  api/        Hono REST API (POST /chat, POST /vote, GET /trip/:id)
  web/        single-page chat UI (HTML/JS; upgrades to Next.js in week 1)
packages/
  schema/     Zod schemas + TypeScript types for MongoDB documents
  seed/       Boston Crew Tokyo trip fixture
  agent/      Gemini interface (mockable), 10 typed tools, agent loop
docs/         design docs (PRD, ARCHITECTURE, MCP_INTEGRATION, AGENT_DESIGN,
              DEMO_SCENARIO, MILESTONES, RESEARCH_NOTES)
test/         integration tests (happy-path scenario)
```

## Status

In-progress. Overnight loop produced docs + scaffold + green happy-path test. See `STATUS.md` (once the loop finishes) for the morning hand-off.

Real Gemini, real Vertex AI Agent Builder, and real MongoDB Atlas wiring lands in week 1 per `docs/MILESTONES.md`.

## License

MIT — see [`LICENSE`](./LICENSE).
