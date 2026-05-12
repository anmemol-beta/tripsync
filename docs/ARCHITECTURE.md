# Architecture

How the pieces fit. One happy-path sequence diagram, one component diagram, one paragraph each.

---

## 1. Component diagram (deploy view)

```
+--------------------------+        +-----------------------+
|  apps/web (Next.js)      |  HTTPS |  apps/api (Hono)      |
|  - chat room UI          | -----> |  - POST /chat         |
|  - vote buttons          | <----- |  - POST /vote         |
|  - mobile-first          |        |  - GET  /trip/:id     |
+--------------------------+        +-----------+-----------+
                                                |
                                                | calls
                                                v
                                    +-----------+-----------+
                                    |  packages/agent       |
                                    |  - system prompt      |
                                    |  - tool schemas (Zod) |
                                    |  - agent loop         |
                                    |    (Gemini 3 fn-call) |
                                    +---+----------------+--+
                                        |                |
                                  Gemini 3              calls tool
                                  (real or mock)        implementations
                                        |                |
                                        v                v
                                +-------+-------+  +-----+-----------+
                                | Gemini API    |  | MongoDB MCP     |
                                | (Vertex AI    |  |   (deploy)      |
                                |  Agent Builder|  |   OR            |
                                |  hosts agent) |  | direct driver   |
                                +---------------+  |   (test/dev)    |
                                                   +--+--------------+
                                                      |
                                                      v
                                              +-------+--------+
                                              | MongoDB Atlas  |
                                              |   (deploy)     |
                                              |     OR         |
                                              | mongodb-memory |
                                              |  -server (test)|
                                              +----------------+
```

**Two-layer tool surface:** in code, the agent calls **typed domain tools** (e.g. `find_trip`, `insert_proposal`). Each domain tool maps to one or two MongoDB MCP primitives (`find`, `insert-one`, `aggregate`). This keeps the LLM-facing schema small and the wire-level MCP call shape compliant. See `MCP_INTEGRATION.md`.

## 2. Sequence diagram — one happy-path turn

User `alice` posts a message; the agent proposes hotels.

```
alice (web)        api               agent loop        Gemini 3        MongoDB
   |                |                    |                 |               |
   |  POST /chat    |                    |                 |               |
   | -------------> |                    |                 |               |
   |                |  invoke(trip_id,   |                 |               |
   |                |    "alice: hotel...")                |               |
   |                | -----------------> |                 |               |
   |                |                    |  generateContent|               |
   |                |                    |  (msg, tools)   |               |
   |                |                    | --------------> |               |
   |                |                    | <-------------- |               |
   |                |                    | functionCall:   |               |
   |                |                    |   find_trip     |               |
   |                |                    |                 |               |
   |                |                    |   find_trip(id) --------------> |
   |                |                    | <-----------------------------  |
   |                |                    |                 |   trip doc    |
   |                |                    | --------------> |               |
   |                |                    | functionResponse|               |
   |                |                    | <-------------- |               |
   |                |                    | functionCall:   |               |
   |                |                    |   search_hotels |               |
   |                |                    | (mock: 5 cards) |               |
   |                |                    | --------------> |               |
   |                |                    | functionCall:   |               |
   |                |                    |  insert_proposal|               |
   |                |                    |    ------------------------>    |
   |                |                    | <-----------------------------  |
   |                |                    | --------------> |               |
   |                |                    | <-------------- |               |
   |                |                    | text: "5 options..."             |
   |                | <----------------- |                 |               |
   | <------------- |                    |                 |               |
   | render 5 cards |                    |                 |               |
```

For the vote turn the path is:

```
bob votes  -> POST /vote  -> append_vote (MongoDB)
alice posts "결정해줘"  -> agent loop
  -> tally_votes (aggregate $group)
  -> update_trip ($set hotel=winner)
  -> append_history (insert event)
  -> agent text: "시부야 그란벨로 결정됐어요."
```

## 3. Why each box is here

- **apps/web**: thin chat room. We do not put product logic in the browser; the browser is a view over agent state.
- **apps/api**: thin HTTP shim. Three endpoints (`/chat`, `/vote`, `/trip/:id`). Forwards to the agent loop, returns the agent's reply.
- **packages/agent**: the brain. Holds the system prompt, the Zod tool schemas, the loop that drives Gemini's function-call protocol. Has a `GeminiClient` interface so we swap real-vs-mock.
- **packages/schema**: Zod schemas for every MongoDB collection. `z.infer` gives us TypeScript types. Validation runs on every write.
- **packages/seed**: deterministic Boston Crew fixture. Loadable into in-memory MongoDB for the happy-path test and into a real Atlas cluster for the demo.

## 4. Concurrency model

- One agent loop instance per chat turn. No background loops.
- Concurrent human messages are serialized at the API layer per `trip_id` (in-memory mutex; fine for hackathon scale). Real deploy would use MongoDB optimistic concurrency on a `trips.revision` counter.
- Votes go through `/vote` independently and do not block the chat path; the agent reads vote state on demand via `tally_votes`.

## 5. What is faked tonight

| Real thing | Tonight's stand-in |
|---|---|
| Gemini 3 API | `MockGeminiClient` driven by a scripted tool-call plan. Same interface as the real client. |
| MongoDB Atlas | `mongodb-memory-server` for tests; local Docker mongod for dev. |
| Vertex AI Agent Builder hosting | Local Node process. Deploy story is documented in `docs/AGENT_DESIGN.md` §Deployment. |
| External hotel search | Canned 5-card response in `packages/agent/src/tools/search_hotels.ts`. |

Each fake is behind an interface so swap-in for the real key is a one-file change. `TODO(real-key)` markers flag the swap points.

## 6. Out-of-scope for this diagram

Auth, photo/EXIF, recap-video, push notifications, payment. See `LOOP_BRIEF.md` §2.5.
