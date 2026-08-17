# Sub-Agent Workflow — TheTrainGame

You are a **sub-agent** working on TheTrainGame, a Warcraft III map written in
TypeScript (compiled to Lua via `typescript-to-lua`). You work on your own git
branch inside your own git worktree. A separate **lead** session (the
user's main Claude chat) merges your branch into `main` and runs the official
build. You never merge to `main`, and you never build or launch anything in the
main checkout — but you **may** build your own branch inside your own worktree
to test it on your VM (see "Building & testing your branch" below).

The user will give you an agent name (e.g. `terrain`, `heroes`). If they
didn't, ask for one before doing anything. Your branch is `agent/<name>` and
your worktree is `.worktrees/<name>/` inside the main project folder:
`C:\Users\gus\Sync\Documents\Games\Warcraft3\TheTrainGame`

## One-time setup (first prompt only)

Skip this if `.worktrees/<name>/` already exists.

```powershell
# From the main project folder
git worktree add .worktrees/<name> -b agent/<name> main

# Give the worktree access to node_modules via a junction (no npm install needed)
New-Item -ItemType Junction -Path ".worktrees\<name>\node_modules" -Target "C:\Users\gus\Sync\Documents\Games\Warcraft3\TheTrainGame\node_modules"
```

> ⚠️ **Junction hazard:** never run `git worktree remove`, `Remove-Item -Recurse`,
> or any recursive delete on your worktree while the junction exists — they
> follow the junction and delete the REAL `node_modules`. See the retire
> procedure at the bottom for the safe order.

## At the START of every prompt

### Reading the automatic hook notices

A project hook injects branch status at every prompt, in every session. It
has two sections — as a sub-agent, here is how to handle them:

- **"Agent branches behind main"** — if YOUR branch is listed, the
  lead merged new work and you MUST sync (command below) before doing
  anything else. Other agents' branches in this list are not your problem.
- **"Pending sub-agent submissions"** — IGNORE this section entirely. It is
  the lead's merge queue. Your own branch appearing there just means
  your submission hasn't been merged yet — that's normal. The
  `git merge --no-ff` instruction in it is for the lead only; never
  run it yourself.

### Sync your branch

Sync at the start of every prompt even if no hook notice appeared yet:

```powershell
git -C .worktrees/<name> merge main
```

**If all your work has been merged into main** (i.e. `git -C .worktrees/<name> log main..HEAD --no-merges` prints nothing), sync by resetting instead of merging, so your branch doesn't accumulate empty sync-merge commits that make the lead's "pending submissions" notice list you as having work when you don't:

```powershell
git -C .worktrees/<name> reset --hard main
```

### Do NOT run a background watcher

Earlier versions of this doc told you to keep a background watcher on `main`
so you would pick up finalized work the moment it landed. **Do not do that.**
An always-armed background task makes your chat display as permanently busy,
so the user can no longer tell which agents are actually working. The latency
it saved bought nothing: you are idle until the user prompts you, and the
`UserPromptSubmit` hook already tells you at the start of every prompt if you
are behind `main`.

So: sync at the start of each prompt (above), and when the hook says you are
behind `main`:

1. Merge: `git -C .worktrees/<name> merge main` — resolve any conflicts
   YOURSELF, using your knowledge of your own changes and what they mean.
   You own this merge; the lead will not do it for you.
2. Typecheck (`npx tsc -p tsconfig.json --noEmit` from your worktree) and
   fix any fallout the new code causes in your work.
3. Commit the merge if it isn't already committed, then report briefly what came in and whether it affected your work.

Resolve any conflicts yourself (keep both sides' intent; when in doubt about
the `main` side, prefer `main` and re-apply your change on top). If your
worktree has uncommitted changes from a previous prompt, commit them first.

## While working

- **Edit files ONLY inside your worktree** (`.worktrees/<name>/...`). Never
  edit, build, or switch branches in the **main checkout** — the lead is
  using it. (Building your own branch **inside your worktree** is fine — see
  below.)
- All commands run with `git -C .worktrees/<name>` or with the worktree as cwd.
- **Never run `npm run build` from the main checkout**, and never run
  `BuildAndLaunch.bat` (it launches WC3 on the developer's own desktop). The
  official `dist/bin` build and merges to `main` are the lead's job.
- For a quick correctness pass without a full build, typecheck:
  ```powershell
  cd .worktrees/<name>; npx tsc -p tsconfig.json --noEmit
  ```
- Avoid editing binary files under `maps/TheTrainGame.w3x/` unless the task
  requires it — binary conflicts can't be merged. If you must, tell the user
  so no other agent touches the same file.

## Building & testing your branch

You **can** build your own branch to test it in-game — the old "never build"
rule was overbroad. The build is entirely **cwd-relative** (`scripts/utils.ts`:
`path.resolve()` off `process.cwd()`, `fs.removeSync("./dist")`, output to
`./dist/bin`, tsconfig rewrite to `./tsconfig.json`), so running it **with your
worktree as the current directory writes only inside your worktree** and never
touches the main checkout's `dist/bin` or `tsconfig.json`. Verified: a worktree
build leaves the main checkout's map byte-identical.

```powershell
# ALWAYS cd into your worktree first — never build from the main checkout.
cd .worktrees/<name>
npm run build          # writes .worktrees/<name>/dist/bin/TheTrainGame.w3x
git checkout -- tsconfig.json   # undo the build's cwd-relative rewrite
```

Rules that keep this safe:

- **cd into your worktree before building.** The build keys off the current
  directory; run it from the main checkout and you overwrite the lead's
  `dist/` and `tsconfig.json`.
- **Never commit `tsconfig.json`.** The build rewrites it with absolute paths;
  restore it afterward (`git checkout -- tsconfig.json`). `dist/` and `*.log`
  are already git-ignored, so those leave no trace.
- **Never launch WC3 on the host** (`BuildAndLaunch.bat`, or the game
  executable) — that steals the developer's desktop. Test through your VM
  instead.

Then test your fresh build in your VM — point the runner at your worktree's
build with `-Map`:

```powershell
# Automated headless measurement (see scripts/vmtest/README.md):
powershell -File scripts/vmtest/run-test.ps1 -Test <name> -Vm <yourvm> `
  -Map .worktrees/<name>/dist/bin/TheTrainGame.w3x

# Or an interactive session you (or the user) can watch and play:
powershell -File scripts/vmtest/manual-session.ps1 -Vm <yourvm> `
  -Map .worktrees/<name>/dist/bin/TheTrainGame.w3x
```

Use your own VM (`-Vm <name>`) so runs never collide with another agent; if its
snapshot isn't minted yet (`ready:false` in `scripts/vmtest/vms.json`) fall back
to `-Vm shared`.

## At the END of every prompt

1. Run the typecheck (above). Fix errors before submitting.
2. Commit everything with a descriptive message:
   ```powershell
   git -C .worktrees/<name> add -A
   git -C .worktrees/<name> commit -m "..."
   ```
3. Verify `git -C .worktrees/<name> status` is clean.
4. End your response with a **submission block** so the user can relay it to
   the lead:

   > **Ready to merge:** branch `agent/<name>`
   > **Summary:** one or two lines describing what changed and anything the
   > lead should watch for (files touched outside `src/`, known risks).

   **Submitting means the work is finished and tested.** The lead merges
   submissions without review or a user test gate — nobody downstream will
   catch a half-done change for you. Test it on your VM first; if it is not
   ready to ship, do not commit it as a submission.

## Project orientation

- `src/main.ts` — entry point; `src/` holds all game logic (track system,
  train, heroes, creeps, teams, victory, etc.).
- `w3ts` (v3.0.2) wraps WC3 natives — see `node_modules/w3ts/*.d.ts` for
  `Unit`, `Trigger`, `Timer`, `MapPlayer`, `Group`, etc.
- `compiletime()` blocks run at build time (object data editing via
  `war3-objectdata-th`); they are inlined into the Lua output.
- `src/constants.ts` holds unit rawcodes and the track skin system.
- Code style: explicit `== null` / `!= null` checks, never `!var` truthiness
  for null checks.

---

## Lead reference (main session only — sub-agents ignore this)

The full lead role — receiving merge requests, verifying that they build,
and finalizing them onto `main` one at a time — is documented in
`LEAD_README.md`. Hand that file to a new main lead session. Since
2026-08-18 a submission is final: the lead merges it without review and
without waiting for the user to test it, so the only thing that bounces a
branch back is a broken typecheck or build.

A UserPromptSubmit hook in `.claude/settings.json` reports any `agent/*`
branch with commits ahead of `main` at the start of every lead prompt —
committed sub-agent work is detected automatically, no explicit notification
needed.

To merge a submitted branch and build:

```powershell
git merge --no-ff agent/<name> -m "Merge agent/<name>: <summary>"
npm run build          # or double-click BuildAndLaunch.bat to build + launch
```

If `tsconfig.json` conflicts, keep `main`'s version.

To retire an agent, remove the junction FIRST (with `cmd /c rmdir`, which
deletes only the link — recursive deletes follow it and destroy the real
`node_modules`), then the worktree:

```powershell
cmd /c rmdir ".worktrees\<name>\node_modules"
git worktree remove .worktrees/<name>
git branch -d agent/<name>
```
