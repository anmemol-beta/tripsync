# Build loop — firing procedure

This is the canonical procedure for one firing of the Tripsync autonomous build loop. A scheduled cron routine fires this. Each firing is a fresh agent with no memory of prior firings — `docs/BACKLOG.md` (committed) is the shared state.

---

## Repo
`anmemol-beta/tripsync`. Each firing runs as a remote scheduled agent on its own fresh clone — there is no local machine, no local files, no local environment variables. Work on the **`loop/auto`** branch only. Never touch `main`.

If `pnpm` is not on PATH, run `corepack enable pnpm` once before the verify steps.

## One firing = one backlog item

1. **Sync.** `cd` into the repo. `git fetch origin`. Checkout `loop/auto` (create it from `origin/main` if it does not exist). `git pull --ff-only origin loop/auto`. If the working tree is dirty or a pull conflict appears, another firing may be mid-run — append a note to `docs/LOOP_LOG.md`, commit nothing else, STOP.

2. **Pick.** Read `docs/BACKLOG.md`. Find the topmost item with status `[ ]` that is not `[blocked]`. Mark it `[~]`, commit just that status flip, push — this claims it. If there is no such item: append "backlog exhausted, idle" to `docs/LOOP_LOG.md`, commit, push, STOP. **Do not invent work.**

3. **Do it.** Implement that ONE item, and only that item. Read the item's description and its **Verify** line — the Verify line is the definition of done.

4. **Verify.** Run `pnpm install` only if dependencies changed, then `pnpm typecheck` and `pnpm test`. All must be green, plus the item's own Verify check.
   - If green → continue.
   - If not green and you cannot make it green within the item's scope → `git restore .` / discard the work, mark the item `[blocked: <one-line reason>]` in `docs/BACKLOG.md`, commit only that status change, push, STOP.

5. **Record.** Mark the item `[x]` and move it to the Done log in `docs/BACKLOG.md` with today's date. Append one line to `docs/LOOP_LOG.md`: `YYYY-MM-DD HH:MM — item N: <title> — <commit shorthash> — typecheck/test green`.

6. **Commit + push.** One atomic commit, message scoped to the item, no `Co-Authored-By` line. `git push origin loop/auto`.

7. **STOP.** The next firing handles the next item.

---

## Hard rules

- **Backlog only.** Never invent items, never refactor unbroken code, never add speculative features or config. If you think the backlog is wrong, note it in `docs/LOOP_LOG.md` — do not act on it.
- **Offline only.** Never run live deploys, never create cloud resources, never need an API key. For key-dependent items, write the code/config/docs behind a clean interface, mark `TODO(needs-user)`, done.
- **Architecture forks:** pick the conservative, easily-reversible option. Record the choice + reason in `docs/DECISIONS.md`. Keep going — do not stop to ask.
- **Surgical.** One item = one commit (plus the claim/status flips). Every changed line traceable to the item. Do not "improve" adjacent code, do not refactor what is not broken, follow the existing code style, prefer the 50-line solution over the 200-line one.
- **Git safety:** never touch `main`, never force-push, never delete branches, never `reset --hard` shared history. Only `fetch` / `checkout loop/auto` / `pull --ff-only` / `commit` / `push origin loop/auto`.
- **Green gate:** `pnpm typecheck` and `pnpm test` must be green at every push to `loop/auto`.
- **No secrets** committed, ever.

## Stopping
The loop stops permanently when the user deletes the cron routine. Until then, each firing either advances one item or idles (backlog exhausted / blocked). It never spins.
