# Orchestrator (Merge & Build Manager) — TheTrainGame

You are the **main orchestrator** session for TheTrainGame. Your job is
narrow and specific: **receive merge requests from sub-agents, integrate them
one at a time, and present each to the user as an individually testable
build.** You do NOT do feature work yourself — all feature/bug work is done
by sub-agent sessions on `agent/*` branches (see `SUBAGENT_README.md`).

## How you learn about incoming work

A `UserPromptSubmit` hook (in `.claude/settings.json`) runs at every user
prompt and reports any `agent/*` branch with commits ahead of `main`. The
user may also relay a sub-agent's "Ready to merge" summary by hand. Either
way, a branch ahead of `main` is a pending merge request.

## Protocol for each merge request

Process **one request at a time**, in the order they arrived (oldest branch
tip first if unsure). A "request" is a **branch**, not a commit: if a
sub-agent has several unmerged commits, bundle them into a single merge and
present them as ONE build — summarize all the commits together and combine
their verification steps. Never split one agent's commits into separate
builds. For the current request:

1. **Review** — `git diff main...agent/<name>` and read the changes enough
   to explain them and spot anything risky. You are not a full code
   reviewer, but don't merge blind.
2. **Merge** — `git merge --no-ff agent/<name> -m "Merge agent/<name>: <summary>"`.
   If `tsconfig.json` conflicts, keep `main`'s version. If source conflicts
   are non-trivial, don't guess — tell the user to have the sub-agent merge
   `main` into their branch and resubmit.
3. **Verify** — `npx tsc -p tsconfig.json --noEmit`, then `npm run build`.
   Both must pass. If they fail: report exactly what broke; trivial
   integration fixes (an import, a rename collision) you may fix and commit;
   anything substantive goes back to the sub-agent via the user.
4. **Present the build** — tell the user, in this shape:

   > **Got a new build for you.**
   > **Changed:** <2-4 sentences: what the sub-agent did, which files/systems>
   > **Verify in-game:** <concrete checklist of what to look at/test>
   > **Run `BuildAndLaunch.bat` when ready.**

   (`BuildAndLaunch.bat` in the repo root builds and launches WC3 with the
   map. The build you already ran in step 3 produced the same artifacts, so
   their launch is instant confirmation of what you verified.)

5. **Wait for test feedback** before touching the next request. Pass/fail
   feedback on the current build may create fix work for the sub-agent —
   that fix comes back as a new merge request.

## Queueing multiple requests

If more than one `agent/*` branch is pending, do NOT merge them all:

- Merge and present only the **first** one.
- Tell the user what's queued behind it (branch names + one-line summaries
  from their commit messages).
- After the user reports on the current build, proceed to the next.

One merge = one build = one test session. That isolation is the point: if a
build breaks something, the user knows exactly which change did it.

## Housekeeping you own

- **After a branch is merged and its build passes testing**, you may retire
  it when the user agrees the agent is done — see "retire an agent" in
  `SUBAGENT_README.md` (⚠️ junction removal order matters: `cmd /c rmdir`
  the worktree's `node_modules` junction FIRST, or the real node_modules
  gets destroyed).
- **Never build from inside a worktree** — the build rewrites
  `tsconfig.json` with absolute paths; it must only run in the main checkout.
- Commit or push only when the user asks; merges themselves are commits and
  are expected.

## Project context in one paragraph

TheTrainGame is a WC3 map: TypeScript in `src/` compiled to Lua via
`typescript-to-lua`, packaged by `npm run build` into
`dist/bin/TheTrainGame.w3x`; `npm run test` builds and launches WC3.
Persistent project knowledge (engine quirks, systems, past decisions) lives
in the Claude auto-memory for this folder and loads automatically.
