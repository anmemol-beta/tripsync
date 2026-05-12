# Research Notes

Findings collected during overnight build loop. Source URLs included so a human can re-verify.

---

## 1. Google Cloud Agent Builder / Gemini Enterprise Agent Platform

### Naming (as of Cloud Next '26)
- Vertex AI Agent Builder is now part of the **Gemini Enterprise Agent Platform**.
- Function calling docs live under `docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling`.

### MCP integration
- Google adopted MCP across its services in December 2025.
- 50+ Google-managed remote MCP servers are GA or in preview at Cloud Next '26.
- Native MCP-enabled services include: Google Maps, BigQuery, Compute Engine, GKE, Cloud Run, Cloud Storage, AlloyDB, Cloud SQL, Spanner, Looker, Pub/Sub.
- Agents point at MCP endpoints (no regional config); auth flows through Cloud IAM Deny policies.
- A Cloud API Registry lets admins manage available tools for developers across the org from the Vertex AI Agent Builder Console (`ApiRegistry`).

### Implication for Trippo
- We treat MongoDB MCP as a remote MCP endpoint the agent is configured to call.
- Locally / for our happy-path test we do NOT need to spin up an MCP server. We define our "tools" as TypeScript functions over the official `mongodb` driver. The MCP wiring is a deployment concern — same tool surface, swappable transport.
- See `docs/MCP_INTEGRATION.md` for the concrete tool list.

### Sources
- https://cloud.google.com/blog/products/ai-machine-learning/google-managed-mcp-servers-are-available-for-everyone
- https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services
- https://cloud.google.com/blog/products/ai-machine-learning/how-to-build-ai-agents-with-google-managed-mcp-servers
- https://cloud.google.com/blog/products/ai-machine-learning/new-enhanced-tool-governance-in-vertex-ai-agent-builder
- https://docs.cloud.google.com/mcp/overview

---

## 2. MongoDB MCP Server (Winter 2026)

### Tool categories
- **Atlas tools** — orgs, projects, clusters, DB user accounts (~13 tools).
- **Local Atlas tools** — list/create/delete local Atlas deployments via `mongodb-atlas-local` image.
- **Database tools** — insert / update / delete / query / aggregation (~24 tools).

### Notable tools we'll lean on (or model after)
- `find` — query a collection
- `insert-one` / `insert-many` (insert-many auto-generates embeddings for vector-indexed fields via Voyage AI)
- `update-one` / `update-many`
- `aggregate` — pipelines (we'll use for vote tally)
- `create-index` (regular + vector)
- `list-knowledge-sources` / `search-knowledge` — MongoDB Assistant knowledge base
- `connect` / `switch-connection`
- `export` — Extended JSON
- `mongodb-logs`

### Implication for Trippo
- Our agent's tool surface is a **typed wrapper around MongoDB CRUD + aggregation**, scoped to the trips/proposals/votes domain. We do NOT expose raw `find` to the LLM — we expose domain tools like `mongodb.find_trip(trip_id)` that *internally* call `find`. This keeps the agent's tool schema legible and the prompts short.
- For the hackathon, "uses MongoDB MCP" is satisfied at the deploy layer (Agent Builder points at the MongoDB MCP server). For the offline happy-path test we call the same domain tools with the in-memory MongoDB.

### Sources
- https://www.mongodb.com/products/tools/mcp-server
- https://www.mongodb.com/docs/mcp-server/overview/
- https://www.mongodb.com/docs/mcp-server/tools/
- https://www.mongodb.com/company/blog/product-release-announcements/whats-new-mongodb-mcp-server-winter-2026-edition
- https://github.com/mongodb-js/mongodb-mcp-server

---

## 3. Gemini 3 function calling

### What changed vs Gemini 2.x
- **Function ID mapping**: every `functionCall` now carries a unique `id`. The `functionResponse` MUST echo that same `id` so the model can map result-to-request. Critical for parallel tool calls.
- **Combined tools**: function calling + built-in tools (Google Search, Maps grounding, File Search, Code Execution, URL Context) in a single API call.
- **Context circulation**: the model retains every tool call + response in context across turns, so a later step can reason over an earlier tool's output (e.g., search weather, then book venue).

### Primary use cases (from Google's docs)
1. Augment Knowledge — query external sources
2. Extend Capabilities — perform computations
3. Take Actions — interact with external systems

### Implication for Trippo
- Our agent will be allowed `Google Search` (or Maps Grounding) for hotel discovery when a real API isn't wired, plus our custom domain tools backed by MongoDB.
- We MUST plumb the per-call `id` through our mock Gemini client so we don't trip ourselves up when we move from mock to real.
- See `docs/AGENT_DESIGN.md` for tool definitions and system prompt.

### Sources
- https://ai.google.dev/gemini-api/docs/function-calling
- https://ai.google.dev/gemini-api/docs/gemini-3
- https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-tooling-updates/
- https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/tools/function-calling
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling

---

## 4. Hackathon judging criteria mapping (inferred from the rules)

Track: MongoDB ($5k / $3k / $2k).

The hackathon emphasizes:
- Agent **must** use Gemini 3 + Google Cloud Agent Builder + MongoDB MCP.
- Multi-step tool use is the central grading axis.
- Open-source repo with detectable LICENSE + ~3 min demo video + hosted URL.

Our differentiator: **shared multi-user state** that the agent reads + writes + reasons over. Solo agents exist; group-collaborative agents with persistent shared memory across human participants do not. MongoDB earns its keep as the live, queryable group memory.

See `docs/PRD.md` §Judging-criteria mapping for explicit mapping.
