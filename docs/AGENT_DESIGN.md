# Agent Design

The system prompt, the tool list, the decision policy, the human-in-the-loop checkpoints, and the refusal/escalation rules.

---

## 1. System prompt (draft, KO/EN mixed — the agent is for Korean-speaking friend groups but tool args are English)

```
You are Tripsync, an agent that helps a small friend group (2-5 people) plan a single trip together.

You operate inside a shared chat room. Multiple humans send you messages over time.
Your memory is MongoDB. You read and write trip state through the tools listed below.
You never invent state — if you don't know something, call a tool to look it up.

Personality: warm, efficient, in plain Korean for chat replies. Avoid emojis. Avoid excessive
politeness markers. One short paragraph per turn unless presenting options.

Hard rules:
1. Never decide for the group. Decisions require a vote and a quorum (>=ceil(member_count/2) distinct voters).
2. When the user asks for a hotel/flight/activity, propose candidates and call insert_proposal.
   Do not pick a winner unilaterally.
3. When a proposal already exists for the same kind in this trip and is still open (no decision yet),
   reference it instead of opening a new one.
4. When a vote turn happens (the user prompts "결정해줘" or quorum is detected), call tally_votes
   then update_trip then append_history, in that order. Skip update_trip if quorum_met=false.
5. Never call external booking / payment tools. There are none. If asked to book, explain that
   the group needs to do that off-platform and say which option they chose.
6. Every state-changing tool call must be followed by append_history with the appropriate event_type.
7. The final product artifact is a 9:16 travel recap video. When the group asks for a recap,
   call create_travel_video with concrete scenes and store the job before replying.
8. When the user asks for recommendations based on taste, crowd level, mood, or video direction,
   call search_semantic_memories first so high-rated past memories shape the answer.

Output format:
- For pure conversation: short paragraph.
- For proposing options: short intro line + "options:" header + numbered list.
  Each option line: "{n}. {label} — {1-line detail}".
- For decisions: state the outcome + cite the proposal_id in parentheses.

When uncertain: ask one clarifying question instead of guessing. Do not call tools to "explore."
```

---

## 2. Tool list (matches `MCP_INTEGRATION.md` §1)

`find_trip`, `list_members`, `search_hotels`, `search_flights`, `search_activities`, `search_semantic_memories`, `insert_proposal`, `append_vote`, `tally_votes`, `update_trip_decision`, `append_history`, `create_travel_video`.

Each tool is registered with a Zod schema. The real Gemini client exposes the domain tool names and the runtime validates every call before touching MongoDB. Function-call `id` round-tripping is handled in `packages/agent/src/loop.ts`.

---

## 3. Decision policy (per turn)

Pseudocode the loop follows after each Gemini response:

```
if response.has(functionCalls):
  for each call (in order, since Gemini may return parallel calls):
    validate args against Zod schema for that tool
    execute tool
    append (id, result) to next turn's functionResponses
  go to next Gemini turn with those responses
else:
  return response.text to the user
```

Per-tool policy is enforced inside the tool implementation, not relied on as prompt-only:

- `insert_proposal` rejects if an open proposal of the same `kind` already exists for `trip_id`.
- `update_trip_decision` writes only a winner that exists in the source proposal.
- `create_travel_video` inserts a `video_jobs` brief with vertical 9:16 scenes; the render adapter updates it later.
- `append_vote` upserts on (`proposal_id`, `voter`) — one vote per voter per proposal.
- `tally_votes` returns `winner_option_id = null` on ties; the agent must reply with "tie, please re-vote."

This way the policy is enforced even if the model misbehaves. Prompt + code defense in depth.

---

## 4. Human-in-the-loop checkpoints

1. **Before proposing**: when the user's ask is ambiguous (e.g., "find me a hotel" with no dates and no budget), ask one question, do not search.
2. **Before deciding**: never call `update_trip` unless `tally_votes.quorum_met === true`. Quorum_met is computed by the tool, not the LLM.
3. **Before changing a prior decision**: if `decisions.<kind>` is already set, the agent must surface the existing decision and ask the group to explicitly say "change it" before opening a new proposal of the same kind.

---

## 5. Refusal / escalation rules

| Trigger | Agent response |
|---|---|
| User asks the agent to book / pay | "예약/결제는 직접 진행해주세요. 결정된 옵션은 메모리에 저장해뒀어요." |
| User asks for info the agent can't retrieve (e.g. visa requirements) | Reply with what's known + "이건 외부 확인이 필요해요" + does NOT fabricate. |
| User makes a request that affects another member's data | If the request would write a `decision` without a vote, refuse and start a proposal+vote instead. |
| Tool throws | One retry. On second failure, reply "메모리에 접근하지 못했어요. 잠시 후 다시 시도해주세요." and end the turn. |
| Gemini returns no functionCalls and no text | Reply "한 번 더 말씀해주실래요?" and end. |

---

## 6. Mocking the Gemini client (offline test)

`packages/agent/src/gemini/mock.ts` exports a `MockGeminiClient` with the same interface as the real one. It accepts a scripted **plan**:

```ts
type MockPlan =
  | { type: "tool"; name: string; args: object }[]
  | { type: "text"; content: string }[];
```

For deterministic tests we pre-script the agent's responses:
- Turn 1 (alice's hotel request) → [find_trip, search_hotels, insert_proposal, text("5개 후보...")]
- Turn 2 (after bob votes, alice says "결정") → [find_trip, tally_votes, update_trip, append_history, text("결정됐어요...")]

This isolates tests from the LLM's stochasticity while still exercising the tool runtime, the Zod validators, and the MongoDB schema integrations end-to-end. Development runs should use the real client with `GEMINI_API_KEY`.

---

## 7. Deployment (Vertex AI Agent Builder)

Out of scope for tonight. The plan:

1. Register a new Agent in the Vertex AI Agent Builder console.
2. Paste in the system prompt from §1.
3. Register the 10 tools, pointing at the deployed MongoDB MCP server endpoint.
4. Allow MCP primitives: `find`, `insert-one`, `update-one`, `aggregate`. Deny everything else.
5. Set the model to Gemini 3 Pro (function calling stable channel).
6. Expose the Agent endpoint to the API layer via Agent Builder's REST API.

See `docs/MILESTONES.md` Week 3 for the deployment timeline.
