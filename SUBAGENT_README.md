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

## Events, not polling

Build behaviour on **events**, never on a timer that keeps checking whether
something changed. A lot of work went into moving the map off polling: a
polled check runs late, runs in the wrong phase, misses a change that came and
went between ticks, and costs every tick for the whole game.

- **Engine events first.** A `Trigger` on the event itself: unit events
  (`registerAnyUnitEvent`), `TriggerRegisterUnitStateEvent` for a value
  crossing a threshold, region enter/leave, item pickup/drop/sell/pawn, the
  sync event. `onSpellEffect(abilityId, cb)` (util.ts) for a spell landing.
- **Our own signals next.** When our code causes the change, the code that
  makes the change announces it, and whoever cares subscribes:
  - `on*(cb)` subscribes, and keeps every listener: `onBoardChanged`,
    `onHeroesSpawned`, `onAllHeroesDead`, `onPlayerLeave`,
    `onSaveCatalogReady`, `registerSyncCallback` (after every `syncState`).
  - `note*()` is a call the changing code makes: `noteTrackPlaced`,
    `noteCampCleared`, `noteDash`, ...
  - No signal for your change yet? Add one where the change happens, as a
    listener array (see boardSignal.ts). Don't watch for it from outside.
- **One-shot delays are fine.** `nextFrame`, or a non-repeating timer for
  "in N seconds" -- that is scheduling, not polling.
- **Genuinely periodic work** (a countdown, damage over time, a rate measured
  over a window, a camera the engine lets drift with no event) needs a
  `// periodic: <reason>` comment on the line or up to three lines above it.
  `npm run build` refuses any repeating timer, periodic trigger or
  `onGlobalTick` listener without one (`scripts/check-rules.js`; tests are
  exempt). The reason is for the reviewer: "it was easier" is not one.
- **Timers die with the board.** Use `createTimer` / `startOneShot`
  (timers.ts): the board teardown destroys them, so a round's pending work
  cannot fire into the next board. A raw `Timer.create()` needs a
  `// untracked: <reason>` comment (something else owns it, or it must fire
  whatever happens), or the build refuses it too.
- **Nothing local decides anything.** Every player's machine runs the same
  script; the game desyncs the moment they decide differently.
  `GetLocalPlayer`, `IsUnitSelected` and the camera answer differently per
  machine. Selection that decides something goes through `selection.ts`; a
  camera point or anything else local gets sent with `BlzSendSyncData` first
  (see `onChatCommandAtCamera` in cheat.ts, saveSync.ts). The build refuses
  those reads without a `// local: <reason>` comment.
- **Derive, don't count.** Recompute state from the world when an event says it
  changed; a counter you maintain by hand drifts the moment one path forgets it.

## Building & testing your branch

You **can** build your own branch to test it in-game — the old "never build"
rule was overbroad. The build is entirely **cwd-relative** (`scripts/utils.ts`
cleans and writes `./dist`, and the war3-transformer paths in `tsconfig.json`
are relative), so running it **with your worktree as the current directory
writes only inside your worktree** and never touches the main checkout's
`dist/bin`. The build no longer rewrites `tsconfig.json`, so there is nothing
to restore afterwards.

```powershell
# ALWAYS cd into your worktree first — never build from the main checkout.
cd .worktrees/<name>
npm run build          # writes .worktrees/<name>/dist/bin/TheTrainGame.w3x
```

**Handing the user a branch build to try:** copy it into their WC3 Download
folder as `TheTrainGame-<name>.w3x`, never over `TheTrainGame.w3x`. That
file is `main`'s build: the lead's publish step rewrites it (and the GitHub
`beta` release) after every merge, and a branch build in its place gets
mistaken for main.

Rules that keep this safe:

- **cd into your worktree before building.** The build keys off the current
  directory; run it from the main checkout and you overwrite the lead's
  `dist/`. `dist/` and `*.log` are git-ignored, so a build leaves no trace.
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

The runner **auto-targets your own VM** from your branch (`agent/<name>`), so
you normally pass no `-Vm` at all. If your VM has no minted snapshot yet
(`ready:false` in `scripts/vmtest/vms.json`), ask the lead to mint it — there
is no shared fallback; the runner refuses `shared`/`base`/`traingametest`
because that is the clone parent and testing on it can corrupt in-flight clones.

**The VM infrastructure is lead-owned.** You write and run tests; you do not
edit `scripts/vmtest/*`, `src/tests/testKit.ts`, or re-mint VMs. When the harness
misbehaves, run `scripts/vmtest/run-test.ps1 -SelfTest` first — it checks
vmrun, your VM, the snapshot, UI coords, `initTestKit` wiring, test
registration, and whether the built map is actually newer than `src/` — and
report that output to the lead rather than fixing the plumbing yourself.

## At the END of every prompt

1. Run the typecheck (above). Fix errors before submitting.
2. Commit everything with a descriptive message:
   ```powershell
   git -C .worktrees/<name> add -A
   git -C .worktrees/<name> commit -m "..."
   ```
3. Verify `git -C .worktrees/<name> status` is clean.
4. **If the work is finished and tested, submit it by messaging the lead**
   with `SendMessage` (`to: "lead"`):

   ```
   Ready to merge: agent/<name> @ <short sha of your tip>
   Summary: one or two lines on what changed, plus anything the lead should
   watch for (files touched outside src/, known risks).
   ```

   Also end your response with the same block, so the user sees what you
   submitted. Don't wait for a reply — the lead merges in the background and
   messages you back.

   **A commit is not a submission; the message is.** Committing unfinished
   work at the end of a prompt is fine (prefix the message `WIP:`) — it
   stays on your branch until you send a submission. The lead merges exactly
   the sha you name, so commits you make after submitting are not swept in.

   **Submitting means the work is finished and tested.** The lead merges
   submissions without review or a user test gate — nobody downstream will
   catch a half-done change for you. Test it on your VM first.

## Messages from the lead

The lead messages you directly (they arrive as `<cross-session-message
from="lead">`). Expect:

- **`Merged: ...`** — your submission is on `main`. Sync (reset or merge,
  per "Sync your branch") before your next piece of work.
- **Notices** — e.g. a harness fix landed, or a VM run of yours overlapped
  something and should be rerun. Act on them as you would a user request,
  as long as they stay within your own worktree, branch and VM.
- **Questions** — e.g. "is this commit meant to be submitted?". Reply with
  `SendMessage` to `lead`.

Message the lead (not the user) for harness/VM breakage too: include the
`run-test.ps1 -SelfTest` output. Messages only reach sessions in the same
permission mode as yours; if a send reports it was held, tell the user.

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

Sub-agents submit by messaging `lead` with a branch and sha (see "At the
END of every prompt"). A UserPromptSubmit hook in `.claude/settings.json`
also lists `agent/*` branches with commits ahead of `main`, but that is
only a backstop: a branch ahead of `main` without a submission message is
work in progress, not a merge request.

To merge a submitted branch and build:

```powershell
git merge --no-ff agent/<name> -m "Merge agent/<name>: <summary>"
npm run build          # or double-click BuildAndLaunch.bat to build + launch
```

To retire an agent, remove the junction FIRST (with `cmd /c rmdir`, which
deletes only the link — recursive deletes follow it and destroy the real
`node_modules`), then the worktree:

```powershell
cmd /c rmdir ".worktrees\<name>\node_modules"
git worktree remove .worktrees/<name>
git branch -d agent/<name>
```
