# Sub-Agent Workflow — TheTrainGame

You are a **sub-agent** working on TheTrainGame, a Warcraft III map written in
TypeScript (compiled to Lua via `typescript-to-lua`). You work on your own git
branch inside your own git worktree. A separate **integrator** session (the
user's main Claude chat) merges your branch into `main` and runs the build.
You never merge to `main` and you never build or launch the game yourself.

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
  integrator merged new work and you MUST sync (command below) before doing
  anything else. Other agents' branches in this list are not your problem.
- **"Pending sub-agent submissions"** — IGNORE this section entirely. It is
  the integrator's merge queue. Your own branch appearing there just means
  your submission hasn't been merged yet — that's normal. The
  `git merge --no-ff` instruction in it is for the integrator only; never
  run it yourself.

### Sync your branch

Sync at the start of every prompt even if no hook notice appeared yet:

```powershell
git -C .worktrees/<name> merge main
```

### Arm your main-watcher (once per session)

So you pick up finalized work immediately instead of at your next prompt,
keep a watcher on `main` running in the background (use your background
execution so its exit re-invokes you as a task notification — don't run it
in the foreground, it blocks):

```bash
cd "C:\Users\gus\Sync\Documents\Games\Warcraft3\TheTrainGame" && base=$(git rev-parse main); while [ "$(git rev-parse main)" = "$base" ]; do sleep 20; done; echo "main moved: $base -> $(git rev-parse main)"
```

Arm it at the start of your first prompt, and re-arm it each time it fires.
When the task notification arrives (the integrator finalized new work):

1. Merge: `git -C .worktrees/<name> merge main` — resolve any conflicts
   YOURSELF, using your knowledge of your own changes and what they mean.
   You own this merge; the integrator will not do it for you.
2. Typecheck (`npx tsc -p tsconfig.json --noEmit` from your worktree) and
   fix any fallout the new code causes in your work.
3. Commit the merge if it isn't already committed, re-arm the watcher, and
   report briefly what came in and whether it affected your work.

Resolve any conflicts yourself (keep both sides' intent; when in doubt about
the `main` side, prefer `main` and re-apply your change on top). If your
worktree has uncommitted changes from a previous prompt, commit them first.

## While working

- **Edit files ONLY inside your worktree** (`.worktrees/<name>/...`). Never
  edit, build, or switch branches in the main checkout — the integrator is
  using it.
- All commands run with `git -C .worktrees/<name>` or with the worktree as cwd.
- **NEVER run** `npm run build`, `npm run test`, or `BuildAndLaunch.bat`. The
  build rewrites `tsconfig.json` with absolute paths and writes to `dist/`;
  from a worktree this corrupts the integrator's setup. Building and in-game
  testing is the integrator's job.
- **Never commit changes to `tsconfig.json`.** If it shows up as modified,
  restore it: `git -C .worktrees/<name> checkout -- tsconfig.json`
- Validate your work with a typecheck instead of a build:
  ```powershell
  cd .worktrees/<name>; npx tsc -p tsconfig.json --noEmit
  ```
- Avoid editing binary files under `maps/TheTrainGame.w3x/` unless the task
  requires it — binary conflicts can't be merged. If you must, tell the user
  so no other agent touches the same file.

## At the END of every prompt

1. Run the typecheck (above). Fix errors before submitting.
2. Commit everything with a descriptive message:
   ```powershell
   git -C .worktrees/<name> add -A
   git -C .worktrees/<name> commit -m "..."
   ```
3. Verify `git -C .worktrees/<name> status` is clean.
4. End your response with a **submission block** so the user can relay it to
   the integrator:

   > **Ready to merge:** branch `agent/<name>`
   > **Summary:** one or two lines describing what changed and anything the
   > integrator should watch for (files touched outside `src/`, known risks,
   > what to test in-game).

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

## Integrator reference (main session only — sub-agents ignore this)

The full integrator role — receiving merge requests, verifying builds, and
presenting them to the user one at a time — is documented in
`ORCHESTRATOR_README.md`. Hand that file to a new main orchestrator session.

A UserPromptSubmit hook in `.claude/settings.json` reports any `agent/*`
branch with commits ahead of `main` at the start of every integrator prompt —
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
