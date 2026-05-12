# Product Requirements — Trippo Agent

> One-pager. An outsider should be able to read this and explain (a) what it is, (b) why it wins the MongoDB track, (c) what each hackathon judging criterion maps to.

---

## 1. One-liner

**Trippo is a group-travel planning agent that lives inside a chat your friends already use, with MongoDB as its shared memory.**

Two to five friends talk to one agent. The agent searches, proposes, runs votes, persists decisions, and keeps everyone in sync — across turns, across sessions, across humans.

---

## 2. The problem

Group trips fragment information by construction:
- The person who booked the hotel has the confirmation email.
- The person who found the activity has it screenshot on their phone.
- The person who paid for tickets has the receipts in their drawer.
- Plans live in a 600-message group chat — half on KakaoTalk, half on iMessage, half forgotten.

Existing travel tools (TripIt, Wanderlog, Polarsteps) are **solo-first**. Existing AI assistants are **stateless solo agents** — they reset every conversation. Neither handles the actual collaborative, multi-session, multi-decision-maker shape of group travel planning.

## 3. The product

A web app where 2–5 friends form a trip group. Inside the group room there is exactly one agent that:

1. Receives natural-language messages from any member.
2. Plans multi-step actions: search hotels → propose → wait for votes → tally → save winner → notify group.
3. Persists everything to MongoDB: the trip, members, messages, proposals, votes, decisions, change history.
4. Reasons over prior turns by querying its own MongoDB memory ("show me what we already agreed on for dinner").
5. Refuses to auto-book or auto-commit until enough humans have voted.

The agent is the product. Chat is its UI. Multi-step tool calls are the value.

## 4. Target user

A 2–5 person friend group planning a 3–10 day trip 1–8 weeks out, where at least one person is willing to read AI-mediated proposals and the rest just want to vote and stop coordinating.

Primary persona: late-20s/30s friend groups, mixed timezones, no single "trip leader," already too many group chats. Will defer to a competent agent that respects "we vote, agent saves" as the decision contract.

## 5. Differentiator vs other agent-builder demos

Solo travel agents are easy. Most hackathon entries will build "ask Gemini to plan my trip." Ours is the only category that **requires shared state across humans**, which is exactly what MongoDB is good at:

| Capability | Solo agent | Trippo |
|---|---|---|
| Reads user input | ✓ | ✓ |
| Calls external tools | ✓ | ✓ |
| Remembers across turns | ✓ (context window) | ✓ (MongoDB) |
| Remembers across sessions | partial (vector store) | ✓ (MongoDB) |
| **Reads state from other humans** | ✗ | ✓ |
| **Resolves disagreement via votes** | ✗ | ✓ |
| **Survives any single member dropping out** | ✗ | ✓ |

MongoDB earns its keep as the live, queryable, multi-writer source of truth for trip state. Take MongoDB out and the product breaks.

## 6. Scope for hackathon (5/11 → 6/11)

In:
- One trip group, 2–5 mock members.
- Happy path: hotel proposal → 3-way vote → decision persisted → change-log entry.
- Two more decision types (flight, activity) following the same pattern.
- Web chat UI, mobile-first.
- Mocked external search where API keys aren't available.

Out:
- Real bookings / payments.
- Photo / EXIF / recap-video (this is the OLD Trippo's surface; the NEW Trippo is agent-first).
- Auth — mock user IDs are enough.
- Push notifications.

## 7. Judging-criteria mapping

The hackathon grades on (per Devpost rules + observed Gemini 3 / Agent Builder messaging):

| Criterion | How Trippo wins |
|---|---|
| **Required stack used (Gemini 3 + Agent Builder + MongoDB MCP)** | All three are core; remove any one and the product breaks. Gemini drives the agent. Agent Builder hosts and observes. MongoDB MCP is the agent's read/write memory. |
| **Multi-step tool use** | Every user turn touches 3–6 tool calls (find_trip → search → insert_proposal → tally_votes → update_trip → append_history). |
| **MongoDB track relevance** | The product's defining property is shared multi-writer state. MongoDB is not a config detail — it is the substrate. |
| **Novel use case** | Group-collaborative agents with persistent shared memory are an unexplored category. The known agent demos are solo. |
| **Production-shape** | Typed schemas, validated tool args, MongoDB indices, deterministic happy-path test runnable in CI, no `any`, clean commit history. |
| **3-min demo** | `docs/DEMO_SCENARIO.md` scripts a watchable 3-min walkthrough of the Boston Crew trip. |

## 8. Success metric for the overnight loop

The integration test in §2.3 of `LOOP_BRIEF.md` passes against an in-memory MongoDB and a mocked Gemini client, asserting the final state of `trips`, `proposals`, `votes`, `decisions`, and `history` collections.
