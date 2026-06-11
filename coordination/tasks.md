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
- Task: Add polished video intro/outro.
- Owner: Codex PM
- Goal: Start with a title card, finish with a closing card, and fade audio/video so the recap does not cut abruptly.
- Verify: typecheck, tests, build, and real MP4 render with ffprobe duration/audio/video.
- Screen agents consulted:
  - antigravity: prompt recorded in `coordination/agd-inbox.md`
  - codex: prompt recorded in `coordination/codex-inbox.md`; sub-agent review received.
- Task: Show selected video ingredients.
- Owner: Codex PM
- Goal: Let the video selection UI show small previews for clips, photos, and scene-linked media.
- Verify: typecheck, web build, and browser surface check.
- Screen agents consulted:
  - antigravity: covered by current video polish feedback loop
  - codex: covered by current video polish feedback loop

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
