# Demo Scenario — 3-minute video script

The hackathon submission requires a ~3 minute demo video. This is the script with timestamps and what's on screen at each beat.

Demo group: **Boston Crew** (seo, jamie, min) planning a Tokyo trip 5/26–5/30. Tokyo, not Boston, because the original Boston trip was the *Remy* product's seed — for the agent demo we use the same friend group on a fresh trip so the MongoDB state is empty and the agent's multi-step writes are visible.

---

## Timeline

| Time | What's on screen | What's said (voiceover) | Tools the agent calls |
|---|---|---|---|
| **0:00–0:10** | Title card: "Trippo — Group travel planning, agent-first". Logo. Tagline: "MongoDB is its memory. Gemini 3 is its brain. Your group chat is its UI." | "Trippo is a group-travel planning agent. Two to five friends, one agent, MongoDB as shared memory." | — |
| **0:10–0:25** | Open the Boston Crew chat. Three members visible. seo types: *"우리 도쿄 5/26-5/30 갈건데 시부야 근처 호텔 추천해줘. 예산 1박 15만원"*. | "Seo asks the agent for a Shibuya hotel. Watch what the agent does — not what it says." | — |
| **0:25–0:55** | Cut to a side panel showing the agent's tool trace, live. Lines appear one by one. | "Three tool calls before it replies. First it loads the trip context from MongoDB. Then it searches. Then it writes a proposal — five options, persisted as a document." | `find_trip`, `search_hotels`, `insert_proposal` |
| **0:55–1:10** | Back to the chat. The agent replies with a numbered list of 5 hotels. Vote buttons under each option. | "The agent doesn't decide. It proposes. The group decides." | — |
| **1:10–1:30** | Cut to phone view. jamie taps option 2. min taps option 2. seo taps option 3. Tool trace panel updates: three `append_vote` writes. | "Each vote is a MongoDB write. The agent isn't in the loop for votes — votes go straight to the collection." | `append_vote` × 3 |
| **1:30–1:45** | seo types: *"결정해줘"*. Agent responds with another tool trace. | "Now seo asks the agent to close it out. The agent reads the votes back, checks quorum, writes the winner to the trip document, and appends a change-log entry." | `find_trip`, `tally_votes`, `update_trip`, `append_history` |
| **1:45–2:00** | Agent's chat reply: *"시부야 그란벨로 호텔 결정됐어요. (2/3 표) 변경 이력에 기록했어요."*. Cut to the trip card showing the hotel decision. | "The decision is now in the trip document. Any future agent turn can read this back." | — |
| **2:00–2:25** | Switch to a MongoDB Compass / Atlas view. Show `trips`, `proposals`, `votes`, `history` collections side-by-side, all populated with the data from the last 90 seconds. Highlight that `history` is append-only. | "This is the actual MongoDB state after one turn. Trip, proposal, votes, history. Take MongoDB out, and the agent forgets who voted, what was proposed, what was decided. The shared memory is the product." | — |
| **2:25–2:40** | Quick second scenario: seo asks for a flight. Agent runs the same pattern: search → propose → vote → decide. Speed it up at 2x. | "Same flow, different decision type. The pattern composes." | full set |
| **2:40–2:55** | Architecture diagram (from `ARCHITECTURE.md` §1). Highlight: Gemini 3 → Agent Builder → MongoDB MCP → MongoDB. | "Gemini 3 drives the loop. Vertex AI Agent Builder hosts and observes. The MongoDB MCP server is the agent's read-write interface to the database." | — |
| **2:55–3:00** | URL slide: live demo URL + GitHub link + "MongoDB Track". Fade to logo. | "Live demo and source linked below." | — |

Total: 3:00.

---

## Pre-record vs live

- **Live in the demo**: the chat interaction (~0:10 → 2:00) — proves the agent works.
- **Pre-rendered** (for safety): the MongoDB collections view at 2:00–2:25 — too risky to flip windows during a recording.

---

## Talk-track principle

Every claim in the voiceover must be backed by what's visible on screen. The judges are looking for: "is the agent actually doing multi-step work over MongoDB, or is it just one LLM call dressed up as an agent." Answer that question every 15 seconds with a tool trace or a database view.

---

## Backup demo (if live agent fails)

We have a pre-recorded 90-second cut showing the happy path against the in-memory test DB. The script collapses to:

- 0:00–0:20 — pitch
- 0:20–1:10 — chat + tool trace (pre-recorded)
- 1:10–1:30 — MongoDB collections view
- 1:30–1:45 — architecture diagram
- 1:45–1:55 — URLs + close

Submit the live-demo version if the agent is up; submit the backup if anything is flaky on the morning of 6/11.
