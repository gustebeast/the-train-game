---
name: subagent
description: Adopt the sub-agent role for TheTrainGame under a given agent name (e.g. /subagent brenner) — work on branch agent/<name> inside worktree .worktrees/<name>, typecheck, commit, and submit to the lead. Use when this session should be a worker agent rather than the lead.
---

# Sub-agent role

The agent name is the argument to this skill (e.g. `/subagent brenner` →
name is `brenner`). **If no name was given, ask for one before doing
anything else** — every rule below is keyed to it.

Read `SUBAGENT_README.md` in the repo root **now** and follow it as your
operating protocol for the rest of this session. It is the source of truth —
this skill only bootstraps you into the role and does not restate it.

## Bootstrap checklist

1. **Read the protocol.** Read `SUBAGENT_README.md` in full before acting.
2. **Check your worktree exists.** If `.worktrees/<name>/` is missing, run the
   one-time setup in the README (worktree + `node_modules` junction).
3. **Sync your branch** — do this at the start of every prompt:
   ```powershell
   git -C .worktrees/<name> merge main
   ```
   If all your work is already merged (`git -C .worktrees/<name> log main..HEAD
   --no-merges` prints nothing), use `reset --hard main` instead so you don't
   accumulate empty sync-merges that make you look like you have pending work.
4. **Arm your main-monitor** with the `Monitor` tool, `persistent: true`
   (command in the README). It never exits — arm it once per session.

## Non-negotiables

- **Edit only inside `.worktrees/<name>/`.** The lead is using the main
  checkout. Never edit, build, or switch branches there.
- ⚠️ **PowerShell cwd resets between turns**, back to the main checkout. Every
  git/typecheck call must either start with `Set-Location` into your worktree
  in the *same* command, or use `git -C .worktrees/<name>`. Never rely on cwd
  persisting. Bare `git commit` after a turn boundary has twice committed to
  the wrong branch — check the branch name in commit output.
- You **may** build your own branch, but only with your worktree as cwd:
  `cd .worktrees/<name>; npm run build`, then `git checkout -- tsconfig.json`.
  Never commit `tsconfig.json` — the build rewrites it with absolute paths.
- **Never launch WC3 on the host** (`BuildAndLaunch.bat`). Test via your VM:
  `scripts/vmtest/run-test.ps1 -Vm <name> -Map .worktrees/<name>/dist/bin/TheTrainGame.w3x`
- **Never merge to `main`.** That is the lead's job.
- Ignore the hook's "Pending sub-agent submissions" section — that's the
  lead's merge queue, not yours. Only act on "behind main" if *your*
  branch is listed.

## Code style

Explicit `== null` / `!= null` checks — never `!var` truthiness for null tests.

## Ending every prompt

Typecheck (`npx tsc -p tsconfig.json --noEmit` from your worktree), fix errors,
commit everything, verify `git status` is clean, then end with the submission
block from the README (`**Ready to merge:** branch agent/<name>` + summary).
