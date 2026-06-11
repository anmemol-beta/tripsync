# Coordination Decisions

Every non-trivial feature commit that changes `apps/`, `packages/`, or `test/` must update this file.

## 2026-06-11

- Added a repository-level coordination harness so feature work has an explicit task ledger, screen-agent inboxes, feedback files, and a pre-commit guard.
- Accepted Codex sub-agent feedback for the demo video flow: seed multiple real travel clips, remove feature-demo beats from recap rendering, make the renderer video-first, add visible generation state in the mobile UI, and require these expectations in tests.
- Accepted selectable recap durations of 60, 90, and 120 seconds. The render API receives the selected duration, updates the video job, and the renderer uses that duration without the previous 60-second cap.
- Accepted recap polish pass: generated title card at the start, closing card at the end, popup timing offset after the intro, video fade out, and soundtrack fade in/out.
- Accepted MP4 output for generated recap videos because h264/aac renders the polished 9:16 video fast enough for the demo while remaining browser-playable.
- Accepted small selection thumbnails in Video Studio so users can identify clips, photos, and scene-linked media before generating.
