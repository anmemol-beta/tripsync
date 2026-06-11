# AGENTS.md

## Git Commit Rules

- Do NOT add "Co-Authored-By" lines to commit messages.
- Keep commit messages clean without attribution footers.

## DB Integration Rules

- After implementing or modifying features connected to a DB, test with real DB data before deployment and verify the data is persisted correctly.

## Screen-Agent Coordination Rules

For any non-trivial feature work that changes `apps/`, `packages/`, or `test/`:

1. Update `coordination/tasks.md` with the task, owner, goal, and verification plan.
2. Ask the active screen agents for feedback before implementation when available.
3. Use `pnpm agent:ask agd --file <prompt>` or `pnpm agent:ask codex --file <prompt>` to record prompts.
4. Record feedback in `coordination/agd-feedback.md` and/or `coordination/codex-feedback.md`.
5. Record the accepted decision in `coordination/decisions.md`.
6. Do not commit feature changes unless `coordination/decisions.md` is staged with the commit.

If direct screen delivery is configured, `scripts/ask-agent.mjs` can forward prompts through `TRIPSYNC_AGENT_SEND_CMD`. Without that setting, it writes the prompt to the appropriate inbox file so the coordination step is still auditable.

Install the local commit guard once per clone:

```sh
git config core.hooksPath .githooks
```

## Karpathy Coding Guidelines

Behavior guide to reduce LLM coding mistakes. Source: Andrej Karpathy.

**Tradeoff:** caution-over-speed. Apply judgment for tiny tasks such as typo fixes or obvious one-line changes.

### 1. Think Before Coding

- State assumptions explicitly before implementation.
- If uncertain, ask instead of guessing.
- If a request has multiple reasonable interpretations, present them instead of silently choosing one.
- Point out a simpler approach when one exists.
- Push back when the requested approach is likely worse.
- If confused, stop and name exactly what is unclear.

### 2. Simplicity First

- Do not add features beyond what was requested.
- Do not add abstractions for one-off code.
- Do not add configurability or flexibility that was not requested.
- Do not add error handling for scenarios that cannot realistically happen.
- If a 200-line implementation can be 50 lines, rewrite it.

### 3. Surgical Changes

- Do not improve adjacent code, comments, or formatting unless required.
- Do not refactor code that is not broken.
- Follow the existing style, even if a different style is personally preferable.
- If unrelated dead code is found, mention it but do not delete it without instruction.
- Remove only imports, variables, or functions made orphaned by the current change.

### 4. Goal-Driven Execution

Convert work into a verifiable goal:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```
