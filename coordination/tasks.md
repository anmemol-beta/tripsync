# Coordination Tasks

Use this file as the PM-visible task ledger before starting non-trivial feature work.

## Active

- Task: Make demo video generation visibly use real travel clips.
- Owner: Codex PM
- Goal: Seed multiple real travel clips, render a mostly-video 60s recap, and show generate-in-progress UI.
- Verify: typecheck, tests, web/api/seed builds, real DB seed verification, actual WebM render with video+audio.
- Screen agents consulted:
  - antigravity: prompt recorded in `coordination/agd-inbox.md`
  - codex: prompt recorded in `coordination/codex-inbox.md`; sub-agent review received.
- Task: Add selectable recap duration.
- Owner: Codex PM
- Goal: Let the mobile UI render 60, 90, or 120 second travel recap videos.
- Verify: schema/typecheck, render API test for 90s, builds, and real render check.
- Screen agents consulted:
  - antigravity: prompt recorded in `coordination/agd-inbox.md`
  - codex: prompt recorded in `coordination/codex-inbox.md`; sub-agent review received.

## Template

```text
Task:
Owner:
Goal:
Verify:
Screen agents consulted:
- antigravity:
- codex:
```
