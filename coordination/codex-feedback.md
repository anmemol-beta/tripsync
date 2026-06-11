# Codex Screen Feedback

Paste or summarize secondary Codex feedback here.

## 2026-06-11

- Sub-agent found that seed data still had a single video asset and an undefined `DEMO_VIDEO_PATH` after the helper rename.
- Sub-agent found `videoRenderer.ts` capped video inputs to three clips, leaving too much of the 60s render as photos.
- Sub-agent found the HTML preview showed only a photo carousel even when media assets existed.
- Sub-agent found the UI render button used only global busy state and did not clearly show generation progress or playback readiness.
- Accepted: update seed to multiple real travel clips, make rendering video-first, show videos in preview, add explicit generation UI, and update tests.

## 2026-06-11 Duration Selection

- Sub-agent found old `60 | 180 | 300` duration contracts in schema and agent tool args.
- Sub-agent found `videoRenderer.ts` clamped WebM generation to 60 seconds.
- Sub-agent found mobile UI copy and types hardcoded to 60 seconds.
- Accepted: replace duration contract with `60 | 90 | 120`, send duration from the UI render action, remove the 60-second render cap, and add test coverage for a 90-second render request.

## 2026-06-11 Intro Outro Polish

- Sub-agent noted intro/outro must fit inside the requested duration, not extend it.
- Sub-agent noted popups need an intro offset so they do not appear over the title card.
- Sub-agent noted audio fade should replace the simple trim/volume chain, and video fade should happen after overlays.
- Accepted: reserve intro/outro duration inside the render budget, add generated title/closing cards, offset popups after intro, and add audio/video fade in/out.
