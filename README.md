# Tripsync

Group travel planning agent for the **Google Cloud Rapid Agent Hackathon (MongoDB track)**.

Built with **Gemini 3** + **Vertex AI Agent Builder** + **MongoDB MCP**.

The agent lives in a chat room shared by 2–5 friends. It plans, proposes, polls, decides, and turns the trip into a vertical recap-video brief. MongoDB is its shared memory and the source of truth for every persisted artifact.

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

`pnpm test:happy-path` runs the canonical planning scenario from `docs/DEMO_SCENARIO.md`: the agent proposes hotels, three members vote, the agent tallies the vote, persists the winner, and appends a change-log entry. All against an in-memory MongoDB. Real development should also run the API with `GEMINI_API_KEY` and a real `MONGODB_URI`.

## Real Vertex AI dev run

The hackathon project is `theta-bliss-486220-s1`. With `gcloud` authenticated and ADC configured, run the API against Vertex AI instead of mock mode:

```bash
gcloud config set project theta-bliss-486220-s1
gcloud auth application-default login

pnpm --filter @tripsync/api build
MONGODB_URI=mongodb://127.0.0.1:27017/trippo_agent_dev \
MONGODB_MCP_ENABLED=true \
GOOGLE_CLOUD_PROJECT=theta-bliss-486220-s1 \
GOOGLE_CLOUD_LOCATION=global \
GEMINI_MODEL=gemini-3-flash-preview \
VERTEX_EMBEDDING_LOCATION=us-central1 \
PORT=4000 \
pnpm --filter @tripsync/api start
```

Current model probe for this project/location:
- Available: `gemini-3-flash-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`
- Not currently available: `gemini-3-pro-preview` returns 404 for this project, even though it is the target hackathon model.

Use `gemini-3-flash-preview` as the default live development model. It works with function calling and Vertex Grounding with Google Search in this project.

## MongoDB MCP smoke

Atlas can be verified through the official MongoDB MCP server:

```bash
MONGODB_URI='mongodb+srv://...' pnpm smoke:mcp
```

The smoke starts `mongodb-mcp-server@latest` in read-only mode, lists MCP tools, then calls the MCP `find` tool against `trippo_agent.trips` for `trip_tokyo_2026_05`.

In the application runtime, the intended flow is: Gemini function calling chooses a Tripsync domain tool, the domain tool calls MongoDB MCP tools such as `find` or `aggregate`, and the MCP server talks to Atlas.

The API keeps a single MongoDB MCP stdio server process for the server lifetime. Domain tools use MCP when `MONGODB_MCP_ENABLED` is not `false`; tests and direct-driver debugging can set it to `false`.

## Atlas Vector Search memory

Rated past-trip memories are embedded with Vertex AI `gemini-embedding-001` and stored in `trip_memories`. The agent can call `search_semantic_memories` so high-rated memories influence recommendations and the final travel-video brief.

```bash
MONGODB_URI='mongodb+srv://...' GOOGLE_CLOUD_PROJECT=theta-bliss-486220-s1 pnpm seed:memories
MONGODB_URI='mongodb+srv://...' GOOGLE_CLOUD_PROJECT=theta-bliss-486220-s1 pnpm smoke:vector
```

`pnpm smoke:vector` waits for the Atlas Vector Search index to become queryable, then verifies that a natural-language query retrieves rated memories from real Atlas data.

## Layout

```
apps/
  api/        Hono REST API (POST /chat, POST /vote, GET /trip/:id/state)
  web/        Vite React mobile UI for chat, voting, trace, and video jobs
packages/
  schema/     Zod schemas + TypeScript types for MongoDB documents
  seed/       Boston Crew Tokyo trip fixture
  agent/      Gemini interface, 12 typed tools, agent loop
docs/         design docs (PRD, ARCHITECTURE, MCP_INTEGRATION, AGENT_DESIGN,
              DEMO_SCENARIO, MILESTONES, RESEARCH_NOTES)
test/         integration tests (happy-path scenario)
```

## Status

In-progress. Overnight loop produced docs + scaffold + green happy-path test. See `STATUS.md` (once the loop finishes) for the morning hand-off.

The local server defaults to real Gemini. Use `AGENT_PROVIDER=mock` only for explicit offline checks.

## License

MIT — see [`LICENSE`](./LICENSE).
