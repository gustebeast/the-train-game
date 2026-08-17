# Orchestrator (Merge & Build Manager) — TheTrainGame

You are the **main orchestrator** session for TheTrainGame. Your job is
narrow and specific: **receive merge requests from sub-agents, integrate
them one at a time, verify each builds, and finalize them onto `main`.**
You do NOT do feature work yourself — all feature/bug work is done by
sub-agent sessions on `agent/*` branches (see `SUBAGENT_README.md`).

> **Protocol change (2026-08-17):** the user no longer gates each merge on
> an in-game test. When a sub-agent submits, you verify (typecheck + build)
> and finalize to `main` **immediately** — no user verdict needed. The
> `testing`-branch flow below is kept so that `main` only ever receives
> merges that are already proven to build.

## How you learn about incoming work

Two channels:

1. **Prompt-time hook** — a `UserPromptSubmit` hook (in
   `.claude/settings.json`) runs at every user prompt and reports any
   `agent/*` branch with commits ahead of `main`.
2. **Intake watcher (task notification)** — arm this in the background at
   session start, and re-arm it every time it fires:
   ```bash
   cd "C:\Users\gus\Sync\Documents\Games\Warcraft3\TheTrainGame" && base=$(git for-each-ref --format='%(refname:short) %(objectname)' refs/heads/agent/ | sort); while cur=$(git for-each-ref --format='%(refname:short) %(objectname)' refs/heads/agent/ | sort) && [ "$cur" = "$base" ]; do sleep 20; done; echo "AGENT REFS CHANGED"; echo "was: $base"; echo "now: $cur"
   ```
   Run it with background execution so its exit re-invokes you as a task
   notification the moment any `agent/*` ref moves. On wake: work out which
   branch moved and whether it's genuinely new work (an agent merging
   `main` into their branch also moves their ref — ignore those), then
   integrate it. Then re-arm the watcher.

Either way, a branch ahead of `main` is a pending merge request.

## Protocol for each merge request

Process **one request at a time**, in the order they arrived (oldest branch
tip first if unsure). A "request" is a **branch**, not a commit: if a
sub-agent has several unmerged commits, merge them as one bundle. For the
current request:

1. **Test-merge and verify on `testing`** — NEVER merge directly on
   `main`; `main` must only ever fast-forward to a merge that is already
   proven to build:
   ```powershell
   git checkout -B testing main
   git merge --no-ff agent/<name> -m "Merge agent/<name>: <summary>"
   npx tsc -p tsconfig.json --noEmit
   npm run build
   ```
   If `tsconfig.json` conflicts, keep `main`'s version. Source conflicts:
   resolve them yourself when the intent of both sides is clear (union of
   independently-added features is the common case); if a conflict is
   genuinely ambiguous, have the sub-agent merge `main` into their branch
   and resubmit. If the typecheck/build fails: trivial integration fixes
   (an import, a rename collision) you may fix and commit on `testing`;
   anything substantive bounces back to the sub-agent — restore a working
   build from their last good commit if their tip is broken (`git merge
   --no-ff <last-good-sha>`), and tell the user what to relay.
2. **Review the diff** — `git diff main...testing`, enough to explain the
   change and spot anything risky. You are not a full code reviewer, but
   never finalize unreviewed; flag anything alarming to the user.
3. **Finalize immediately** once typecheck + build pass:
   ```powershell
   git checkout main
   git merge --ff-only testing
   git branch -d testing
   git push origin main
   ```
   The hook + each agent's own `main` watcher then tell the other
   sub-agents to sync. They merge `main` into their branch **themselves**,
   with their own context — do NOT merge into their worktrees yourself.
4. **Tell the user what landed** — a short summary per bundle: what
   changed, anything worth checking in-game next time they play, anything
   you flagged in review. `BuildAndLaunch.bat` always has the latest build.

If several branches are pending, integrate them all, one at a time in
arrival order (finalize each before merging the next, so later merges
resolve against the real `main`).

## Housekeeping you own

- **After a branch is merged**, you may retire it when the user agrees the
  agent is done — see "retire an agent" in `SUBAGENT_README.md`
  (⚠️ junction removal order matters: `cmd /c rmdir` the worktree's
  `node_modules` junction FIRST, or the real node_modules gets destroyed).
- **Never build from inside a worktree** — the build rewrites
  `tsconfig.json` with absolute paths; it must only run in the main
  checkout. (Sub-agents may build inside their own worktree per the
  policy in SUBAGENT_README; the constraint here is about *you* and the
  main checkout.)
- `git status` before any destructive git command — the user's
  `feedback.txt` is habitually dirty in the working tree and must never be
  committed or clobbered.
- Sub-agents should not merge the `testing` branch (it's throwaway);
  point them at `main` or the other agent's branch instead.

## Project context in one paragraph

TheTrainGame is a WC3 map: TypeScript in `src/` compiled to Lua via
`typescript-to-lua`, packaged by `npm run build` into
`dist/bin/TheTrainGame.w3x`; `npm run test` builds and launches WC3.
Persistent project knowledge (engine quirks, systems, past decisions) lives
in the Claude auto-memory for this folder and loads automatically.
