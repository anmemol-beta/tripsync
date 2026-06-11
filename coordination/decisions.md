# Coordination Decisions

Every non-trivial feature commit that changes `apps/`, `packages/`, or `test/` must update this file.

## 2026-06-11

- Added a repository-level coordination harness so feature work has an explicit task ledger, screen-agent inboxes, feedback files, and a pre-commit guard.
- Accepted Codex sub-agent feedback for the demo video flow: seed multiple real travel clips, remove feature-demo beats from recap rendering, make the renderer video-first, add visible generation state in the mobile UI, and require these expectations in tests.
